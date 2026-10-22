<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Inventory\Inv;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
});

/** Every booked entry of the company balances; returns [debit, credit] of one entry. */
function purchEntryBalanced(string $entryId): array
{
    [$debit, $credit] = PurchKit::entryTotals($entryId);
    expect($debit)->toBe($credit);

    return [$debit, $credit];
}

it('books VAT withholding: full input VAT, payable less the withheld part, withheld VAT to 360', function (): void {
    $w = $this->w;
    $invoice = PurchKit::post($w->user, $w->company, 'purchase-invoices', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'supplier_invoice_no' => 'W-1',
        'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '1000', 'withholding_code_id' => $w->withholding->id]],
    ])->assertCreated()
        ->assertJsonPath('data.tax_total', '200.0000')
        ->assertJsonPath('data.withholding_total', '100.0000')
        ->assertJsonPath('data.total', '1200.0000')
        ->assertJsonPath('data.payable_total', '1100.0000')
        ->assertJsonPath('data.lines.0.withholding_rate', '50.0000')
        ->json('data');
    $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()
        ->assertJsonPath('data.balance_due', '1100.0000')->assertJsonPath('data.match_status', 'unmatched')->json('data');

    expect(PurchKit::journal($booked['journal_entry_id']))->toBe([
        '191' => ['debit' => '200.00', 'credit' => '0.00'],
        '320' => ['debit' => '0.00', 'credit' => '1100.00'],
        '360' => ['debit' => '0.00', 'credit' => '100.00'],
        '770' => ['debit' => '1000.00', 'credit' => '0.00'],
    ]);
    expect(purchEntryBalanced($booked['journal_entry_id']))->toBe(['1200.00', '1200.00']);

    // A withholding code needs VAT on the line; a VAT code is not a withholding code.
    PurchKit::post($w->user, $w->company, 'purchase-invoices', [
        'party_id' => $w->party->id, 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '10', 'tax_code_id' => null, 'withholding_code_id' => $w->withholding->id]],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.withholding_code_id']));
    PurchKit::post($w->user, $w->company, 'purchase-invoices', [
        'party_id' => $w->party->id, 'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '10', 'withholding_code_id' => $w->vat->id]],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.withholding_code_id']));
});

it('values receipts at the order net price converted to company currency per base unit', function (): void {
    $w = $this->w;
    $box = Inv::unit($w->company, 'BOX');
    Catalog::itemUnit($w->company, $w->item, $box, '12');
    // Unit box, 10% discount: net 216 USD, 2 boxes = 24 pieces.
    $order = PurchKit::post($w->user, $w->company, 'purchase-orders', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'currency_code' => 'USD', 'fx_rate' => '30',
        'lines' => [['item_id' => $w->item->id, 'unit_id' => $box->id, 'quantity' => '2', 'unit_price' => '120', 'discount_percent' => '10']],
    ])->assertCreated()->assertJsonPath('data.lines.0.base_quantity', '24.000000')->assertJsonPath('data.lines.0.net_amount', '216.0000')->json('data');
    $order = PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/submit")->assertOk()->json('data');
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '2']);

    expect($receipt['currency_code'])->toBe('USD')
        ->and($receipt['fx_rate'])->toBe('30.000000')
        ->and($receipt['lines'][0]['unit_cost'])->toBe('270.000000')
        ->and($receipt['cost_total'])->toBe('6480.0000')
        ->and(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('24.000000')
        ->and(Inv::valuation($w->company, $w->item->id, $w->wh->id)['avg_cost'])->toStartWith('270.');

    // Invoiced at another rate: accrual cleared at receipt value, the rest is price variance;
    // the payable carries the currency amount.
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id'], 'USD-1', ['fx_rate' => '32']);
    expect($invoice['total_local'])->toBe('8294.4000')
        ->and($invoice['lines'][0]['grni_amount'])->toBe('6480.0000')
        ->and($invoice['lines'][0]['variance_amount'])->toBe('432.0000')
        ->and(PurchKit::journal($invoice['journal_entry_id']))->toBe([
            '191' => ['debit' => '1382.40', 'credit' => '0.00'],
            '320' => ['debit' => '0.00', 'credit' => '8294.40'],
            '381' => ['debit' => '6480.00', 'credit' => '0.00'],
            '621' => ['debit' => '432.00', 'credit' => '0.00'],
        ]);
    $payable = DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')->where('l.entry_id', $invoice['journal_entry_id'])
        ->where('a.code', '320')->first(['l.*']);
    expect((string) $payable->currency_code)->toBe('USD')
        ->and(PurchKit::dec((string) $payable->fx_amount)->isEqualTo('259.2'))->toBeTrue()
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000');
});

it('clears the goods received accrual to zero when a receipt is invoiced in uneven parts', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '3', '33.333333']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '3']);
    $line = $receipt['lines'][0]['id'];
    $variance = PurchKit::dec('0');

    foreach (['1', '1', '1'] as $n => $qty) {
        $invoice = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", [
            'document_date' => '2027-06-13', 'supplier_invoice_no' => "PART-{$n}", 'lines' => [['receipt_line_id' => $line, 'quantity' => $qty]],
        ])->assertCreated()->json('data');
        $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->json('data');
        purchEntryBalanced($booked['journal_entry_id']);
        $variance = $variance->plus($booked['lines'][0]['variance_amount']);
    }

    expect(PurchKit::balance($w->company, '381'))->toBe('0.0000')
        ->and(PurchKit::dec(PurchKit::balance($w->company, '621'))->isEqualTo($variance))->toBeTrue()
        ->and($variance->abs()->isLessThan('0.05'))->toBeTrue();
    PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'invoiced')
        ->assertJsonPath('data.lines.0.invoiced_quantity', '3.000000');
    // Nothing is left to invoice on the receipt.
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", ['supplier_invoice_no' => 'PART-X'])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines']));
});

it('books a price variance when the supplier invoices another price (price override)', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '4', '25']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '4']);
    $body = [
        'document_date' => '2027-06-13', 'supplier_invoice_no' => 'PV-1',
        'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '4', 'unit_price' => '26']],
    ];

    // A different price than the receipt (order) price needs purchasing.price_override.
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", $body)
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.unit_price']));
    $buyer = PurchKit::user(['purchasing.price_override']);
    $invoice = PurchKit::post($buyer, $w->company, "purchase-receipts/{$receipt['id']}/invoice", $body)->assertCreated()
        ->assertJsonPath('data.lines.0.price_source', 'manual')->assertJsonPath('data.match_status', 'price_variance')->json('data');
    $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()
        ->assertJsonPath('meta.warnings.0.code', 'purchasing.match_variance')->json('data');

    expect(PurchKit::journal($booked['journal_entry_id']))->toBe([
        '191' => ['debit' => '20.80', 'credit' => '0.00'],
        '320' => ['debit' => '0.00', 'credit' => '124.80'],
        '381' => ['debit' => '100.00', 'credit' => '0.00'],
        '621' => ['debit' => '4.00', 'credit' => '0.00'],
    ]);
    $audit = PurchKit::get($w->user, $w->company, "purchase-invoices/{$invoice['id']}")->json('data.audit');
    expect(collect($audit)->pluck('event')->all())->toContain('price_override');
});

it('keeps every journal balanced and equal to the invoice totals in company currency', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '7', '13.37'], [$w->service->id, '3', '19.99']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '7']);
    $invoice = PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/invoices", ['document_date' => '2027-06-13', 'supplier_invoice_no' => 'BAL-1'])
        ->assertCreated()->json('data');
    $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->json('data');
    [$debit, $credit] = purchEntryBalanced($booked['journal_entry_id']);

    expect(PurchKit::dec($debit)->isEqualTo($booked['total_local']))->toBeTrue()
        ->and(PurchKit::dec($credit)->isEqualTo($booked['total_local']))->toBeTrue()
        ->and(count($booked['lines']))->toBe(2)
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000')
        ->and($receipt['status'])->toBe('posted');
});

it('reverses an invoice symmetrically and reopens the receipt and order for invoicing', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '40']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id'], 'REV-1');
    $before = PurchKit::journal($invoice['journal_entry_id']);

    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/reverse", ['date' => '2027-06-14'])->assertStatus(422);
    $reversed = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/reverse", ['date' => '2027-06-14', 'reason' => 'Wrong invoice'])
        ->assertOk()->assertJsonPath('data.status', 'reversed')->assertJsonPath('data.balance_due', '0.0000')->json('data');
    $after = PurchKit::journal($reversed['reversal_journal_entry_id']);

    foreach ($before as $code => $sides) {
        expect($after[$code])->toBe(['debit' => $sides['credit'], 'credit' => $sides['debit']]);
    }

    expect(PurchKit::balance($w->company, '320'))->toBe('0.0000')
        ->and(PurchKit::balance($w->company, '381'))->toBe('-200.0000');
    PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'received')
        ->assertJsonPath('data.lines.0.invoiced_quantity', '0.000000');
    // Replay of the reversal books nothing more; the receipt can be invoiced again (same supplier number).
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/reverse", ['date' => '2027-06-14', 'reason' => 'x'])
        ->assertOk()->assertJsonPath('meta.replayed', true);
    $again = PurchKit::invoiceReceipt($w, $receipt['id'], 'REV-1');
    expect($again['status'])->toBe('booked')->and(PurchKit::balance($w->company, '381'))->toBe('0.0000');
});

it('reverses a posted receipt that nothing invoiced: stock and accrual back, order reopened', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '40']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $clerk = Actors::user(['purchasing.receipts.view', 'purchasing.receipts.update']);
    PurchKit::post($clerk, $w->company, "purchase-receipts/{$receipt['id']}/cancel", ['reason' => 'x'])->assertForbidden();

    PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/cancel", ['reason' => 'Wrong goods', 'date' => '2027-06-14'])
        ->assertOk()->assertJsonPath('data.status', 'cancelled');
    expect(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('0.000000')
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000')
        ->and(PurchKit::balance($w->company, '153'))->toBe('0.0000');
    PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'approved')
        ->assertJsonPath('data.lines.0.received_quantity', '0.000000');

    // An invoiced receipt cannot be reversed.
    $second = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    PurchKit::invoiceReceipt($w, $second['id'], 'RC-1');
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$second['id']}/cancel", ['reason' => 'x'])->assertStatus(422);
});

it('receives goods at booking with receive_on_invoice and clears the accrual at once', function (): void {
    $w = $this->w;
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '3', '20']]);

    // Goods without a receipt need receive_on_invoice.
    PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/invoices", ['supplier_invoice_no' => 'ROI-1'])->assertStatus(422);
    $invoice = PurchKit::post($w->user, $w->company, "purchase-orders/{$order['id']}/invoices", [
        'document_date' => '2027-06-13', 'supplier_invoice_no' => 'ROI-1', 'receive_on_invoice' => true,
    ])->assertCreated()->assertJsonPath('data.lines.0.receipt_line_id', null)->json('data');
    $booked = PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->json('data');

    expect($booked['lines'][0]['receipt_line_id'])->not->toBeNull()
        ->and(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('3.000000')
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000')
        ->and(PurchKit::balance($w->company, '153'))->toBe('60.0000');
    $receipt = DB::table('purchase_receipts')->where('invoice_id', $invoice['id'])->first();
    expect($receipt->status)->toBe('posted');
    PurchKit::get($w->user, $w->company, "purchase-orders/{$order['id']}")->assertJsonPath('data.status', 'invoiced');

    // Reversing with reverse_stock takes the automatic receipt back.
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/reverse", ['reason' => 'x', 'reverse_stock' => true])->assertOk();
    expect(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('0.000000')
        ->and(DB::table('purchase_receipts')->where('id', $receipt->id)->value('status'))->toBe('cancelled')
        ->and(PurchKit::balance($w->company, '381'))->toBe('0.0000');
});

it('returns not yet invoiced goods from a receipt; the accrual moves by the receipt cost', function (): void {
    $w = $this->w;
    // Average cost 45 in stock (two receipts), the returned goods were received at 50.
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '10', '50']]);
    $other = PurchKit::approvedOrder($w, [[$w->item->id, '10', '40']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '10']);
    PurchKit::receive($w, $other['id'], [$other['lines'][0]['id'] => '10']);

    $return = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/returns", [
        'document_date' => '2027-06-14', 'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '4']],
    ])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/approve")->assertOk();
    $shipped = PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/ship")->assertOk()
        ->assertJsonPath('data.lines.0.cost_total', '180.0000')->assertJsonPath('data.lines.0.receipt_cost', '200.0000')->json('data');
    // Debit only applies to invoiced goods.
    PurchKit::post($w->user, $w->company, "purchase-returns/{$return['id']}/debit")->assertStatus(422);
    // Shipping: Dr 381 180 / Cr 153 180, correction Dr 381 20 / Cr 621 20.
    expect(PurchKit::journal($shipped['journal_entry_id']))->toBe([
        '381' => ['debit' => '20.00', 'credit' => '0.00'],
        '621' => ['debit' => '0.00', 'credit' => '20.00'],
    ]);

    // Only the 6 that stayed can be invoiced; the accrual of this receipt is then cleared.
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", [
        'supplier_invoice_no' => 'RR-0', 'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '7']],
    ])->assertStatus(422);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id'], 'RR-1');
    expect($invoice['lines'][0]['quantity'])->toBe('6.000000')
        ->and($invoice['lines'][0]['grni_amount'])->toBe('300.0000')
        ->and(PurchKit::balance($w->company, '381'))->toBe('-400.0000')
        ->and(Inv::onHand($w->company, $w->item->id, $w->wh->id))->toBe('16.000000');
});

it('gives back the number when booking fails after it was assigned (gapless)', function (): void {
    $w = $this->w;
    $first = PurchKit::post($w->user, $w->company, 'purchase-invoices', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'supplier_invoice_no' => 'G-1',
        'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->json('data');
    $second = PurchKit::post($w->user, $w->company, 'purchase-invoices', [
        'party_id' => $w->party->id, 'document_date' => '2027-06-10', 'supplier_invoice_no' => 'G-2',
        'lines' => [['item_id' => $w->service->id, 'quantity' => '1', 'unit_price' => '100']],
    ])->json('data');

    // Without an expense rule the journal cannot be determined: the booking rolls back with its number.
    DB::table('account_determination_rules')->where('company_id', $w->company)->where('event_key', 'purchase.expense')->update(['is_active' => false]);
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$first['id']}/book")->assertStatus(422);
    expect(DB::table('purchase_invoices')->where('id', $first['id'])->value('number'))->toBeNull();
    DB::table('account_determination_rules')->where('company_id', $w->company)->where('event_key', 'purchase.expense')->update(['is_active' => true]);

    $a = PurchKit::post($w->user, $w->company, "purchase-invoices/{$second['id']}/book")->assertOk()->json('data.number');
    $b = PurchKit::post($w->user, $w->company, "purchase-invoices/{$first['id']}/book")->assertOk()->json('data.number');
    expect($a)->toBe('PIN2027000000001')->and($b)->toBe('PIN2027000000002');
});
