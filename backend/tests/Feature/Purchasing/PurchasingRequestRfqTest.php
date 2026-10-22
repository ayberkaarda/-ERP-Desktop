<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->second = PurchKit::supplier($this->w->company, ['name' => 'Supplier B']);
    $this->request = PurchKit::post($this->w->user, $this->w->company, 'purchase-requests', [
        'needed_by' => '2027-07-01', 'notes' => 'Q3 stock',
        'lines' => [
            ['item_id' => $this->w->item->id, 'quantity' => '10', 'estimated_price' => '50', 'suggested_supplier_id' => $this->w->party->id],
            ['item_id' => $this->w->service->id, 'quantity' => '1', 'estimated_price' => '300'],
        ],
    ])->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.estimated_total', '800.0000')->json('data');
});

it('turns an approved request into an RFQ, compares quotes and awards one order per supplier', function (): void {
    $w = $this->w;
    // A draft request cannot be quoted yet.
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/rfq", ['supplier_ids' => [$w->party->id]])->assertStatus(422);
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/submit")->assertOk()->assertJsonPath('data.status', 'approved');

    $rfq = PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/rfq", [
        'supplier_ids' => [$w->party->id, $this->second->id], 'response_due' => '2027-06-20',
    ])->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.request_id', $this->request['id'])->json('data');
    expect($rfq['lines'])->toHaveCount(2)->and($rfq['suppliers'])->toHaveCount(2);
    [$goods, $setup] = [$rfq['lines'][0]['id'], $rfq['lines'][1]['id']];

    // Quotes only after sending; only invited suppliers quote.
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $w->party->id, 'quotes' => [['rfq_line_id' => $goods, 'unit_price' => '48']]])
        ->assertStatus(422);
    $sent = PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/send")->assertOk()->assertJsonPath('data.status', 'sent')->json('data');
    expect($sent['number'])->toStartWith('RFQ2027');
    $stranger = PurchKit::supplier($w->company);
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $stranger->id, 'quotes' => [['rfq_line_id' => $goods, 'unit_price' => '1']]])
        ->assertStatus(422);

    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $w->party->id, 'quotes' => [
        ['rfq_line_id' => $goods, 'unit_price' => '50', 'discount_percent' => '10', 'lead_time_days' => 10],
        ['rfq_line_id' => $setup, 'unit_price' => '350', 'lead_time_days' => 3],
    ]])->assertOk()->assertJsonPath('data.status', 'collecting');
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $this->second->id, 'quotes' => [
        ['rfq_line_id' => $goods, 'unit_price' => '46', 'lead_time_days' => 5],
        ['rfq_line_id' => $setup, 'unit_price' => '280', 'lead_time_days' => 7],
    ]])->assertOk();

    $matrix = PurchKit::get($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/comparison")->assertOk()->json('data');
    // Goods: A nets 45.00 (lowest), B 46 (fastest). Setup: B 280 lowest, A fastest.
    expect($matrix['lines'][0]['quotes'][0]['party_id'])->toBe($w->party->id)
        ->and($matrix['lines'][0]['quotes'][0]['net_unit_price'])->toBe('45.000000')
        ->and($matrix['lines'][0]['quotes'][0]['lowest_price'])->toBeTrue()
        ->and($matrix['lines'][0]['quotes'][1]['fastest'])->toBeTrue()
        ->and($matrix['lines'][1]['quotes'][0]['party_id'])->toBe($this->second->id)
        ->and($matrix['lowest_total_party_id'])->toBe($this->second->id);

    // Award per line: goods to A, setup to B -> one draft order each at the quoted prices.
    $awarded = PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/award", ['lines' => [
        ['rfq_line_id' => $goods, 'party_id' => $w->party->id], ['rfq_line_id' => $setup, 'party_id' => $this->second->id],
    ]])->assertCreated()->assertJsonPath('data.status', 'awarded')->json('data');
    expect($awarded['orders'])->toHaveCount(2);
    $orderA = collect($awarded['orders'])->firstWhere('party_id', $w->party->id);
    expect($orderA['status'])->toBe('draft')
        ->and($orderA['lines'][0]['unit_price'])->toBe('50.000000')
        ->and($orderA['lines'][0]['discount_percent'])->toBe('10.0000')
        ->and($orderA['lines'][0]['price_source'])->toBe('quote')
        ->and($orderA['lines'][0]['rfq_line_id'])->toBe($goods)
        ->and($orderA['lines'][0]['request_line_id'])->toBe($this->request['lines'][0]['id'])
        ->and($orderA['rfq_id'])->toBe($rfq['id']);

    $request = PurchKit::get($w->user, $w->company, "purchase-requests/{$this->request['id']}")->assertJsonPath('data.status', 'ordered')->json('data');
    expect($request['links']['orders'])->toHaveCount(2)->and($request['links']['rfqs'])->toHaveCount(1);
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/award", ['party_id' => $w->party->id])->assertStatus(422);
});

it('orders a request directly, bounded by what it still lacks; a cancelled order reopens it', function (): void {
    $w = $this->w;
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/submit")->assertOk();
    $line = $this->request['lines'][0]['id'];

    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/orders", [
        'party_id' => $w->party->id, 'lines' => [['request_line_id' => $line, 'quantity' => '11']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.quantity']));

    $order = PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/orders", [
        'party_id' => $w->party->id, 'expected_date' => '2027-06-30', 'lines' => [['request_line_id' => $line, 'quantity' => '6', 'unit_price' => '49']],
    ])->assertCreated()->assertJsonPath('data.lines.0.unit_price', '49.000000')->assertJsonPath('data.request_id', $this->request['id'])->json('data');
    PurchKit::get($w->user, $w->company, "purchase-requests/{$this->request['id']}")->assertJsonPath('data.status', 'partially_ordered')
        ->assertJsonPath("data.ordered_quantities.{$line}", '6.000000');

    // Editing the order cannot exceed the request either.
    PurchKit::patch($w->user, $w->company, "purchase-orders/{$order['id']}", [
        'version' => $order['version'], 'lines' => [['id' => $order['lines'][0]['id'], 'item_id' => $w->item->id, 'quantity' => '11']],
    ])->assertStatus(422);
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/orders", [
        'party_id' => $w->party->id, 'lines' => [['request_line_id' => $line, 'quantity' => '5']],
    ])->assertStatus(422);

    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
    PurchKit::get($w->user, $w->company, "purchase-requests/{$this->request['id']}")->assertJsonPath('data.status', 'approved');
    // Suppliers only: a customer cannot receive an order.
    $customer = \Tests\Support\Sales\SalesKit::party($w->company);
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/orders", ['party_id' => $customer->id])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['party_id']));
});

it('keeps drafts editable and refuses edits after submission', function (): void {
    $w = $this->w;
    PurchKit::patch($w->user, $w->company, "purchase-requests/{$this->request['id']}", ['version' => 99, 'notes' => 'x'])->assertStatus(409);
    $edited = PurchKit::patch($w->user, $w->company, "purchase-requests/{$this->request['id']}", [
        'version' => $this->request['version'], 'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'estimated_price' => '10']],
    ])->assertOk()->assertJsonPath('data.estimated_total', '20.0000')->json('data');
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/submit")->assertOk();
    PurchKit::patch($w->user, $w->company, "purchase-requests/{$this->request['id']}", ['version' => $edited['version'] + 1, 'notes' => 'y'])->assertStatus(422);
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
    PurchKit::post($w->user, $w->company, "purchase-requests/{$this->request['id']}/submit")->assertStatus(422)
        ->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
});
