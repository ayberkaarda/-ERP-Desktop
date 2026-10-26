<?php

declare(strict_types=1);

use App\Modules\Sales\Events\SalesDeliveryPosted;
use App\Modules\Sales\Events\SalesInvoiceIssued;
use App\Modules\Sales\Events\SalesOrderConfirmed;
use App\Modules\Sales\Events\SalesReturnCredited;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    SalesKit::boot();
    $this->company = SalesKit::company();
    $this->wh = SalesKit::warehouse($this->company);
    $this->unit = SalesKit::unit($this->company);
    $this->vat = SalesKit::taxCode($this->company, '20.0000');
    $this->item = SalesKit::item($this->company, ['code' => 'WIDGET', 'name' => 'Widget', 'default_tax_code_id' => $this->vat->id], $this->unit);
    $this->service = SalesKit::item($this->company, ['code' => 'SETUP', 'name' => 'Setup', 'type' => 'service', 'default_tax_code_id' => $this->vat->id], $this->unit);
    $this->party = SalesKit::party($this->company, ['name' => 'Acme']);
    $this->user = SalesKit::user();
    SalesKit::receive($this->company, $this->wh->id, $this->item->id, '10', '50');
});

it('runs quote -> order -> delivery -> invoice -> return with stock, journal and events in step', function (): void {
    Event::fake([SalesOrderConfirmed::class, SalesDeliveryPosted::class, SalesInvoiceIssued::class, SalesReturnCredited::class]);

    $quote = SalesKit::post($this->user, $this->company, 'sales-quotes', [
        'party_id' => $this->party->id, 'document_date' => '2027-06-10',
        'lines' => [
            ['item_id' => $this->item->id, 'quantity' => '5', 'unit_price' => '100', 'discount_percent' => '10'],
            ['item_id' => $this->service->id, 'quantity' => '1', 'unit_price' => '200'],
        ],
    ])->assertCreated()
        ->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.subtotal', '700.0000')
        ->assertJsonPath('data.discount_total', '50.0000')
        ->assertJsonPath('data.tax_total', '130.0000')
        ->assertJsonPath('data.total', '780.0000')
        ->assertJsonPath('data.valid_until', '2027-07-10')
        ->json('data');

    $order = SalesKit::post($this->user, $this->company, "sales-quotes/{$quote['id']}/convert", ['document_date' => '2027-06-11'])
        ->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.total', '780.0000')->json('data');
    SalesKit::get($this->user, $this->company, "sales-quotes/{$quote['id']}")->assertJsonPath('data.status', 'converted')
        ->assertJsonPath('data.links.order.id', $order['id']);

    $confirmed = SalesKit::post($this->user, $this->company, "sales-orders/{$order['id']}/confirm")->assertOk()
        ->assertJsonPath('data.status', 'confirmed')->json('data');
    expect($confirmed['number'])->toStartWith('ORD2027')
        ->and($confirmed['lines'][0]['reservation_id'])->not->toBeNull();
    Event::assertDispatched(SalesOrderConfirmed::class);

    $stockLine = $confirmed['lines'][0];
    $delivery = SalesKit::post($this->user, $this->company, "sales-orders/{$order['id']}/deliveries", [
        'document_date' => '2027-06-12', 'lines' => [['order_line_id' => $stockLine['id'], 'quantity' => '4']],
    ])->assertCreated()->json('data');
    $posted = SalesKit::post($this->user, $this->company, "sales-deliveries/{$delivery['id']}/post")->assertOk()
        ->assertJsonPath('data.status', 'posted')
        ->assertJsonPath('data.cost_total', '200.0000')
        ->assertJsonPath('data.lines.0.unit_cost', '50.000000')
        ->json('data');
    expect($posted['number'])->toStartWith('DLV2027')->and(Inv::onHand($this->company, $this->item->id, $this->wh->id))->toBe('6.000000');
    SalesKit::get($this->user, $this->company, "sales-orders/{$order['id']}")
        ->assertJsonPath('data.status', 'partially_delivered')
        ->assertJsonPath('data.lines.0.delivered_quantity', '4.000000');
    // The reservation was consumed by the delivered part only.
    expect((string) DB::table('stock_reservations')->where('id', $stockLine['reservation_id'])->value('quantity'))->toBe('1.000000');

    $invoice = SalesKit::post($this->user, $this->company, "sales-deliveries/{$delivery['id']}/invoice", ['document_date' => '2027-06-13'])
        ->assertCreated()->assertJsonPath('data.total', '432.0000')->json('data');
    $issued = SalesKit::post($this->user, $this->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()
        ->assertJsonPath('data.status', 'issued')
        ->assertJsonPath('data.balance_due', '432.0000')
        ->json('data');
    expect($issued['number'])->toBe('INV2027000000001');

    expect(SalesKit::journal($issued['journal_entry_id']))->toBe([
        '120' => ['debit' => '432.00', 'credit' => '0.00'],
        '391' => ['debit' => '0.00', 'credit' => '72.00'],
        '600' => ['debit' => '0.00', 'credit' => '360.00'],
    ]);
    SalesKit::get($this->user, $this->company, "sales-orders/{$order['id']}")
        ->assertJsonPath('data.status', 'partially_invoiced')->assertJsonPath('data.lines.0.invoiced_quantity', '4.000000');

    $return = SalesKit::post($this->user, $this->company, "sales-invoices/{$invoice['id']}/returns", [
        'document_date' => '2027-06-14', 'reason' => 'Damaged', 'lines' => [['invoice_line_id' => $issued['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated()->assertJsonPath('data.total', '108.0000')->assertJsonPath('data.lines.0.unit_cost', '50.000000')->json('data');
    SalesKit::post($this->user, $this->company, "sales-returns/{$return['id']}/approve")->assertOk()->assertJsonPath('data.status', 'approved');
    $received = SalesKit::post($this->user, $this->company, "sales-returns/{$return['id']}/receive")->assertOk()
        ->assertJsonPath('data.status', 'received')->json('data');
    expect(Inv::onHand($this->company, $this->item->id, $this->wh->id))->toBe('7.000000');
    expect(SalesKit::journal($received['journal_entry_id']))->toBe([
        '153' => ['debit' => '50.00', 'credit' => '0.00'],
        '621' => ['debit' => '0.00', 'credit' => '50.00'],
    ]);

    $credited = SalesKit::post($this->user, $this->company, "sales-returns/{$return['id']}/credit")->assertOk()
        ->assertJsonPath('data.status', 'credited')->json('data');
    $note = SalesKit::get($this->user, $this->company, "sales-invoices/{$credited['credit_invoice_id']}")->assertOk()
        ->assertJsonPath('data.invoice_type', 'return')->assertJsonPath('data.status', 'issued')->assertJsonPath('data.total', '108.0000')->json('data');
    expect($note['number'])->toBe('CRN2027000000001')
        ->and(SalesKit::journal($note['journal_entry_id']))->toBe([
            '120' => ['debit' => '0.00', 'credit' => '108.00'],
            '391' => ['debit' => '18.00', 'credit' => '0.00'],
            '610' => ['debit' => '90.00', 'credit' => '0.00'],
        ]);

    Event::assertDispatched(SalesDeliveryPosted::class);
    Event::assertDispatched(SalesInvoiceIssued::class, 2);
    Event::assertDispatched(SalesReturnCredited::class);

    // Ledger: receivable 432 - 108, stock 500 - 200 + 50, COGS 200 - 50.
    expect(SalesKit::balance($this->company, '120'))->toBe('324.0000')
        ->and(SalesKit::balance($this->company, '153'))->toBe('350.0000')
        ->and(SalesKit::balance($this->company, '621'))->toBe('150.0000')
        ->and(Inv::totalValue($this->company))->toBe('350.0000');
});
