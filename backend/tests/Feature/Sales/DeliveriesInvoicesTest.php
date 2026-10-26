<?php

declare(strict_types=1);

use App\Modules\Accounting\Models\AccountDeterminationRule;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Sales\Events\SalesInvoiceReversed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
});

it('bounds deliveries by the remaining quantity plus the over-delivery tolerance (drafts included)', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '5', '100']]);
    $line = $order['lines'][0]['id'];

    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", ['lines' => [['order_line_id' => $line, 'quantity' => '3']]])->assertCreated();
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", ['lines' => [['order_line_id' => $line, 'quantity' => '3']]])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => str_contains($f['lines.0.quantity'][0], '2.000000'));

    SalesKit::setting($this->w->company, 'sales.allow_over_delivery_percent', 20);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", ['lines' => [['order_line_id' => $line, 'quantity' => '3']]])->assertCreated();
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries", ['lines' => [['order_line_id' => $line, 'quantity' => '0.5']]])->assertStatus(422);

    // Service lines are not delivered; foreign lines are refused.
    $mixed = SalesKit::confirmedOrder($this->w, [[$this->w->service->id, '1', '50']]);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$mixed['id']}/deliveries", ['lines' => [['order_line_id' => $mixed['lines'][0]['id'], 'quantity' => '1']]])->assertStatus(422);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$mixed['id']}/deliveries", ['lines' => [['order_line_id' => $line, 'quantity' => '1']]])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.order_line_id']));
});

it('delivers everything remaining by default, marks the order delivered and refuses drafts and closed orders', function (): void {
    $draft = SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '2', 'unit_price' => '10']],
    ])->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$draft['id']}/deliveries")->assertStatus(422);

    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '10'], [$this->w->service->id, '1', '5']]);
    $delivery = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries")->assertCreated()
        ->assertJsonCount(1, 'data.lines')->assertJsonPath('data.lines.0.quantity', '2.000000')->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk();
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'delivered');
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries")->assertStatus(422);
});

it('posts a delivery once: replays return the same document, movements and journal', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/deliveries")->json('data');
    $key = (string) Str::uuid7();

    $first = SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post", [], $key)->assertOk()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post", [], $key)->assertOk()
        ->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.number', $first['number']);
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk()
        ->assertJsonPath('meta.replayed', true)->assertJsonPath('data.stock_document_id', $first['stock_document_id']);

    expect(DB::table('stock_movements')->where('document_id', $first['stock_document_id'])->count())->toBe(1)
        ->and(DB::table('journal_entries')->where('source_type', 'stock_document')->where('source_id', $first['stock_document_id'])->count())->toBe(1)
        ->and(Inv::onHand($this->w->company, $this->w->item->id, $this->w->wh->id))->toBe('8.000000')
        ->and(DB::table('sales_deliveries')->where('id', $delivery['id'])->value('cost_total'))->toBe('100.0000');
});

it('needs the company setting for deliveries without an order', function (): void {
    $payload = ['party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '1', 'unit_price' => '10']]];
    SalesKit::post($this->w->user, $this->w->company, 'sales-deliveries', $payload)->assertStatus(422);

    SalesKit::setting($this->w->company, 'sales.allow_direct_delivery', true);
    $delivery = SalesKit::post($this->w->user, $this->w->company, 'sales-deliveries', $payload)->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk()->assertJsonPath('data.status', 'posted');
    SalesKit::post($this->w->user, $this->w->company, 'sales-deliveries', [...$payload, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1']]])
        ->assertStatus(422);
});

it('never invoices more than delivered and splits an order line over its deliveries', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '6', '100'], [$this->w->service->id, '2', '50']]);
    [$stock, $service] = [$order['lines'][0]['id'], $order['lines'][1]['id']];
    $d1 = SalesKit::deliver($this->w, $order['id'], [$stock => '2']);
    $d2 = SalesKit::deliver($this->w, $order['id'], [$stock => '1']);

    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/invoices", ['lines' => [['order_line_id' => $stock, 'quantity' => '4']]])
        ->assertStatus(422);
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/invoices", ['lines' => [['order_line_id' => $service, 'quantity' => '3']]])
        ->assertStatus(422);

    $invoice = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/invoices", [
        'lines' => [['order_line_id' => $stock, 'quantity' => '3'], ['order_line_id' => $service, 'quantity' => '2']],
    ])->assertCreated()->assertJsonCount(3, 'data.lines')->json('data');
    expect($invoice['lines'][0]['delivery_line_id'])->toBe($d1['lines'][0]['id'])
        ->and($invoice['lines'][0]['quantity'])->toBe('2.000000')
        ->and($invoice['lines'][1]['delivery_line_id'])->toBe($d2['lines'][0]['id'])
        ->and($invoice['lines'][2]['delivery_line_id'])->toBeNull();

    // The draft holds the delivered quantity: nothing more can be invoiced.
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$d1['id']}/invoice")->assertStatus(422);
    SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['delivery_line_id' => $d1['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422);

    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk();
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'partially_invoiced')
        ->assertJsonPath('data.lines.0.invoiced_quantity', '3.000000')->assertJsonPath('data.lines.1.invoiced_quantity', '2.000000');
});

it('requires a delivery for stock goods unless deliver_on_invoice, which posts one at issue', function (): void {
    $payload = ['party_id' => $this->w->party->id, 'document_date' => '2027-06-14', 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '2', 'unit_price' => '100']]];
    SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', $payload)->assertStatus(422);

    $invoice = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [...$payload, 'deliver_on_invoice' => true])->assertCreated()->json('data');
    $issued = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()->json('data');
    $delivery = DB::table('sales_deliveries')->where('invoice_id', $invoice['id'])->first();

    expect($issued['lines'][0]['delivery_line_id'])->not->toBeNull()
        ->and($delivery->status)->toBe('posted')
        ->and(Inv::onHand($this->w->company, $this->w->item->id, $this->w->wh->id))->toBe('8.000000');
    // The automatic delivery is reversed with its invoice only.
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery->id}/cancel", ['reason' => 'x'])->assertStatus(422);

    Event::fake([SalesInvoiceReversed::class]);
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/reverse", ['reason' => 'Wrong customer', 'reverse_stock' => true])->assertOk()
        ->assertJsonPath('data.status', 'reversed')->assertJsonPath('data.balance_due', '0.0000');
    expect(DB::table('sales_deliveries')->where('id', $delivery->id)->value('status'))->toBe('cancelled')
        ->and(Inv::onHand($this->w->company, $this->w->item->id, $this->w->wh->id))->toBe('10.000000');
    Event::assertDispatched(SalesInvoiceReversed::class, fn (SalesInvoiceReversed $e): bool => $e->stockReversed);
});

it('invoices services of an order without delivery and finishes the order', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->service->id, '2', '50']]);
    $invoice = SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$order['id']}/invoices")->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk();
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'invoiced');
});

it('books the journal of an invoice equal to its totals, with currency data for foreign invoices', function (): void {
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => '2027-06-13', 'forex_buying' => '32.123456', 'forex_selling' => '32.123456']);
    $invoice = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-13', 'currency_code' => 'USD',
        'lines' => [['item_id' => $this->w->service->id, 'quantity' => '3', 'unit_price' => '33.33'], ['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10.01', 'tax_code_id' => null]],
    ])->assertCreated()->assertJsonPath('data.fx_rate', '32.123456')->json('data');
    $issued = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()->json('data');

    $lines = DB::table('journal_lines')->where('entry_id', $issued['journal_entry_id'])->get();
    $debit = $lines->reduce(fn ($c, $l) => $c->plus((string) $l->debit), SalesKit::dec('0'));
    $credit = $lines->reduce(fn ($c, $l) => $c->plus((string) $l->credit), SalesKit::dec('0'));
    $receivable = $lines->first(fn ($l) => $l->currency_code === 'USD');
    $journal = SalesKit::journal($issued['journal_entry_id']);

    expect((string) $debit->toScale(4))->toBe((string) $credit->toScale(4))
        ->and((string) $debit->toScale(4))->toBe($issued['total_local'])
        ->and($journal['391']['credit'])->toBe(SalesKit::dec($issued['tax_total_local'])->toScale(2)->__toString())
        ->and($journal['600']['credit'])->toBe(SalesKit::dec($issued['total_local'])->minus($issued['tax_total_local'])->toScale(2)->__toString())
        ->and((string) $receivable->fx_amount)->toBe($issued['total'])
        ->and($issued['total'])->toBe('130.0000')
        ->and(substr((string) $receivable->fx_rate, 0, 9))->toBe('32.123456')
        ->and($receivable->party_id)->toBe($this->w->party->id)
        ->and((string) $receivable->due_date)->toBe('2027-06-13');
});

it('reverses an invoice symmetrically and gives the quantity back to the order', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);

    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/reverse", [])->assertStatus(422);
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/reverse", ['reason' => 'x', 'date' => '2027-06-01'])->assertStatus(422);
    $reversed = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/reverse", ['reason' => 'Price error', 'date' => '2027-06-15'])
        ->assertOk()->assertJsonPath('data.status', 'reversed')->json('data');

    $original = SalesKit::journal($invoice['journal_entry_id']);
    $mirror = SalesKit::journal($reversed['reversal_journal_entry_id']);
    foreach ($original as $code => $sides) {
        expect($mirror[$code])->toBe(['debit' => $sides['credit'], 'credit' => $sides['debit']]);
    }
    expect(SalesKit::balance($this->w->company, '120'))->toBe('0.0000')
        ->and(SalesKit::balance($this->w->company, '600'))->toBe('0.0000');
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'delivered')
        ->assertJsonPath('data.lines.0.invoiced_quantity', '0.000000');

    // Replay returns the reversed invoice; the delivery can now be invoiced again or cancelled.
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/reverse", ['reason' => 'again'])->assertOk()->assertJsonPath('meta.replayed', true);
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/cancel", ['reason' => 'Returned before billing'])->assertOk()
        ->assertJsonPath('data.status', 'cancelled');
    expect(Inv::onHand($this->w->company, $this->w->item->id, $this->w->wh->id))->toBe('10.000000');
    SalesKit::get($this->w->user, $this->w->company, "sales-orders/{$order['id']}")->assertJsonPath('data.status', 'confirmed')
        ->assertJsonPath('data.lines.0.delivered_quantity', '0.000000');
});

it('does not cancel an invoiced delivery and does not reverse an invoice with returns or payments', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$delivery['id']}/cancel", ['reason' => 'x'])->assertStatus(422);

    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']]])->assertCreated();
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/reverse", ['reason' => 'x'])->assertStatus(422);
});

it('assigns gapless invoice numbers: a failed issue gives its number back', function (): void {
    $make = fn (): array => SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->json('data');
    $first = $make();
    $rules = SalesKit::in($this->w->company, fn () => AccountDeterminationRule::query()->where('event_key', 'sales.vat_output')->get());
    SalesKit::in($this->w->company, fn () => AccountDeterminationRule::query()->where('event_key', 'sales.vat_output')->update(['is_active' => false]));

    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$first['id']}/issue")->assertStatus(422);
    expect(DB::table('sales_invoices')->where('id', $first['id'])->value('number'))->toBeNull()
        ->and(DB::table('journal_entries')->where('source_type', 'sales_invoice')->count())->toBe(0);

    SalesKit::in($this->w->company, fn () => AccountDeterminationRule::query()->whereIn('id', $rules->pluck('id'))->update(['is_active' => true]));
    $second = $make();
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$second['id']}/issue")->assertOk()->assertJsonPath('data.number', 'INV2027000000001');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$first['id']}/issue")->assertOk()->assertJsonPath('data.number', 'INV2027000000002');
    // Issued twice: same number, one journal entry.
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$first['id']}/issue")->assertOk()->assertJsonPath('meta.replayed', true);
    expect(DB::table('journal_entries')->where('source_type', 'sales_invoice')->count())->toBe(2);
});

it('refuses issuing into a closed period', function (): void {
    $invoice = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2026-12-20', 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertStatus(422);
    expect(DB::table('sales_invoices')->where('id', $invoice['id'])->value('status'))->toBe('draft');
});

it('bounds returns by the invoiced quantity and credits them at the original price and rate', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '3', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '3']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);
    $line = $invoice['lines'][0]['id'];

    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $line, 'quantity' => '4']]])->assertStatus(422);
    $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $line, 'quantity' => '2']]])
        ->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $line, 'quantity' => '2']]])->assertStatus(422);

    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/receive")->assertStatus(422)->assertJsonPath('errors.code', 'INVALID_STATE_TRANSITION');
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/approve")->assertOk()->assertJsonPath('data.number', 'RET2027000000001');
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/credit")->assertStatus(422);
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/receive")->assertOk();
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/receive")->assertOk()->assertJsonPath('meta.replayed', true);
    $credited = SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/credit")->assertOk()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/credit")->assertOk()->assertJsonPath('meta.replayed', true);

    $note = SalesKit::get($this->w->user, $this->w->company, "sales-invoices/{$credited['credit_invoice_id']}")->json('data');
    expect($note['total'])->toBe('240.0000')->and($note['original_invoice_id'])->toBe($invoice['id'])
        ->and($note['lines'][0]['original_line_id'])->toBe($line)
        ->and(DB::table('stock_movements')->where('document_id', $credited['stock_document_id'])->value('movement_type'))->toBe('return_in');

    // Reversing the credit note reopens the return for crediting.
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$note['id']}/reverse", ['reason' => 'Issued twice'])->assertOk();
    SalesKit::get($this->w->user, $this->w->company, "sales-returns/{$return['id']}")->assertJsonPath('data.status', 'received')->assertJsonPath('data.credit_invoice_id', null);
});

it('reconciles: COGS booked equals the stock movement cost of deliveries and returns', function (): void {
    SalesKit::receive($this->w->company, $this->w->wh->id, $this->w->item->id, '10', '62.5');
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '7', '100']]);
    $d1 = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '3']);
    $d2 = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '4']);
    $invoice = SalesKit::invoiceDelivery($this->w, $d2['id']);
    $return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/returns", ['lines' => [['invoice_line_id' => $invoice['lines'][0]['id'], 'quantity' => '1']]])->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/approve");
    SalesKit::post($this->w->user, $this->w->company, "sales-returns/{$return['id']}/receive")->assertOk();

    $movementCost = SalesKit::dec((string) DB::table('stock_movements')->where('company_id', $this->w->company)->where('movement_type', 'issue')->selectRaw('coalesce(sum(total_cost), 0) AS s')->value('s'))
        ->minus((string) DB::table('stock_movements')->where('company_id', $this->w->company)->where('movement_type', 'return_in')->selectRaw('coalesce(sum(total_cost), 0) AS s')->value('s'));
    $deliveryCost = SalesKit::dec((string) DB::table('sales_deliveries')->where('company_id', $this->w->company)->where('status', 'posted')->selectRaw('coalesce(sum(cost_total), 0) AS s')->value('s'));

    expect(SalesKit::balance($this->w->company, '621'))->toBe((string) $movementCost->toScale(4))
        ->and((string) $deliveryCost->toScale(4))->toBe((string) SalesKit::dec($d1['cost_total'])->plus($d2['cost_total'])->toScale(4))
        ->and(Inv::totalValue($this->w->company))->toBe(SalesKit::balance($this->w->company, '153'))
        ->and(Inv::invariants($this->w->company)['balances'][0])->toBe(Inv::invariants($this->w->company)['balances'][1]);
});
