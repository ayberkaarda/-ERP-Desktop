<?php

declare(strict_types=1);

use Brick\Math\BigDecimal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Purchasing\Reports\PurchReportKit as Kit;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->h = Kit::history();
    $this->w = $this->h->w;
    $this->get = fn (string $uri) => Kit::report($this->w, $uri)->assertOk();
    $this->june = 'date_from=2027-06-01&date_to=2027-06-30';
});

it('sums purchases per period the way the invoices and debit notes were booked and reversed', function (): void {
    $month = ($this->get)("purchases-by-period?{$this->june}");
    expect($month->json('meta.totals'))->toBe([
        'invoice_count' => 4, 'debit_note_count' => 1, 'reversal_count' => 1, 'purchases_amount' => '812.0000', 'returns_amount' => '52.0000',
        'net_amount' => '760.0000', 'tax_amount' => '152.0000', 'total_amount' => '912.0000', 'withholding_amount' => '20.0000', 'payable_amount' => '892.0000',
    ])->and($month->json('data.0.period'))->toBe('2027-06')
        ->and($month->json('meta.by_currency'))->toBe([
            ['currency_code' => 'TRY', 'purchases_amount' => '512.0000', 'returns_amount' => '52.0000', 'net_amount' => '460.0000', 'net_amount_local' => '460.0000'],
            ['currency_code' => 'USD', 'purchases_amount' => '10.0000', 'returns_amount' => '0.0000', 'net_amount' => '10.0000', 'net_amount_local' => '300.0000'],
        ]);

    $days = Kit::by(($this->get)('purchases-by-period?period=day&date_from=2027-06-10&date_to=2027-06-16')->json('data'), 'period');
    expect(array_keys($days))->toBe(['2027-06-10', '2027-06-11', '2027-06-12', '2027-06-13', '2027-06-14', '2027-06-15', '2027-06-16'])
        ->and($days['2027-06-10']['net_amount'])->toBe('0.0000')
        ->and($days['2027-06-11']['net_amount'])->toBe('300.0000')
        ->and($days['2027-06-12']['net_amount'])->toBe('100.0000')
        ->and($days['2027-06-13']['net_amount'])->toBe('312.0000')
        ->and($days['2027-06-14']['withholding_amount'])->toBe('20.0000')
        ->and($days['2027-06-14']['payable_amount'])->toBe('220.0000')
        // The reversal of INV3 and the debit note: -100 purchases, 52 returns.
        ->and($days['2027-06-15']['net_amount'])->toBe('-152.0000')
        ->and($days['2027-06-15']['reversal_count'])->toBe(1)
        ->and($days['2027-06-15']['tax_amount'])->toBe('-30.4000');

    $weeks = ($this->get)('purchases-by-period?period=week&date_from=2027-06-01&date_to=2027-06-30')->json('data');
    expect(array_column($weeks, 'period'))->toBe(['2027-W22', '2027-W23', '2027-W24', '2027-W25', '2027-W26'])
        ->and($weeks[0]['period_start'])->toBe('2027-05-31')
        ->and(Kit::sum($weeks, 'net_amount'))->toBe('760.0000');

    // A range before the reversal keeps INV3 as a purchase.
    expect(($this->get)('purchases-by-period?date_from=2027-06-01&date_to=2027-06-14')->json('meta.totals.net_amount'))->toBe('912.0000');
});

it('groups purchases by supplier and item with shares, codes and names', function (): void {
    $suppliers = ($this->get)("by-supplier?{$this->june}")->json('data');
    expect(array_column($suppliers, 'party_name'))->toBe(['Supplier A', 'Supplier Beta'])
        ->and($suppliers[0]['party_code'])->toBe($this->w->party->code)
        ->and($suppliers[0]['net_amount'])->toBe('460.0000')
        ->and($suppliers[0]['payable_amount'])->toBe('532.0000')
        ->and($suppliers[0]['share_percent'])->toBe('60.53')
        ->and($suppliers[1]['net_amount'])->toBe('300.0000')
        ->and(Kit::sum($suppliers, 'net_amount'))->toBe('760.0000');

    $items = Kit::by(($this->get)("by-item?{$this->june}")->json('data'), 'item_code');
    expect($items['WIDGET'])->toMatchArray([
        'item_name' => 'Widget', 'item_type' => 'stock', 'purchased_quantity' => '6.000000', 'returned_quantity' => '1.000000',
        'net_quantity' => '5.000000', 'average_price' => '52.0000', 'purchases_amount' => '312.0000', 'returns_amount' => '52.0000', 'net_amount' => '260.0000',
    ])->and($items['SETUP'])->toMatchArray(['purchased_quantity' => '2.000000', 'net_amount' => '500.0000', 'reversal_count' => 1]);

    $top = ($this->get)("top-suppliers?{$this->june}&limit=1");
    expect($top->json('data'))->toHaveCount(1)
        ->and($top->json('data.0'))->toMatchArray(['rank' => 1, 'party_name' => 'Supplier A', 'cumulative_share_percent' => '60.53', 'party_code' => $this->w->party->code])
        ->and($top->json('meta.others'))->toBe(['supplier_count' => 1, 'net_amount' => '300.0000', 'share_percent' => '39.47']);
});

it('applies supplier, item, currency, warehouse and category filters', function (): void {
    $f = fn (string $q) => ($this->get)("purchases-by-period?{$this->june}&{$q}")->json('meta.totals.net_amount');
    $category = Catalog::category($this->w->company, 'GOODS')->id;
    DB::table('items')->where('id', $this->w->item->id)->update(['category_id' => $category]);

    expect($f("party_id={$this->h->beta->id}"))->toBe('300.0000')
        ->and($f("item_id={$this->w->item->id}"))->toBe('260.0000')
        ->and($f('currency_code=USD'))->toBe('300.0000')
        ->and($f("category_id={$category}"))->toBe('260.0000')
        // Every document of the history is in the default warehouse.
        ->and($f("warehouse_id={$this->w->wh->id}"))->toBe('760.0000')
        ->and($f('warehouse_id='.Str::uuid7()))->toBe('0.0000')
        ->and(($this->get)("by-supplier?{$this->june}&item_id={$this->w->service->id}")->json('meta.totals.net_amount'))->toBe('500.0000')
        ->and(($this->get)("open-orders?party_id={$this->w->party->id}")->json('data'))->toBe([])
        ->and(($this->get)("receipt-vs-invoice?party_id={$this->h->beta->id}")->json('data'))->toBe([])
        ->and(($this->get)('supplier-ageing?currency_code=USD')->json('meta.totals.balance_local'))->toBe('360.0000')
        ->and(($this->get)("return-rate?{$this->june}&category_id={$category}")->json('meta.totals.returned_value'))->toBe('50.0000');
});

it('lists the order backlog per line, order, supplier and item with days late', function (): void {
    $lines = ($this->get)('open-orders');
    expect($lines->json('data'))->toHaveCount(1)
        ->and($lines->json('data.0'))->toMatchArray([
            'order_number' => $this->h->o2['number'], 'party_name' => 'Supplier Beta', 'expected_date' => '2027-06-12', 'days_late' => 3,
            'item_code' => 'WIDGET', 'quantity' => '4.000000', 'received_quantity' => '0.000000', 'open_quantity' => '4.000000',
            'open_value' => '320.0000', 'open_value_local' => '320.0000',
        ])
        ->and($lines->json('meta.totals'))->toBe(['order_count' => 1, 'line_count' => 1, 'open_value_local' => '320.0000']);

    // A partial receipt of O2 leaves 1 open; O1 (fully received, service invoiced) never shows.
    PurchKit::receive((object) [...(array) $this->w, 'party' => $this->h->beta], $this->h->o2['id'], [$this->h->o2['lines'][0]['id'] => '3'], '2027-06-15');

    foreach (['line', 'order', 'supplier', 'item'] as $by) {
        $res = ($this->get)("open-orders?group_by={$by}");
        expect(Kit::sum($res->json('data'), 'open_value_local'))->toBe('80.0000', $by)
            ->and($res->json('meta.totals.open_value_local'))->toBe('80.0000', $by);
    }

    expect(($this->get)('open-orders?group_by=supplier')->json('data.0'))->toMatchArray(['party_code' => $this->h->beta->code, 'order_count' => 1, 'line_count' => 1])
        ->and(($this->get)('open-orders?group_by=item')->json('data.0'))->toMatchArray(['item_code' => 'WIDGET', 'open_base_quantity' => '1.000000'])
        ->and(($this->get)('open-orders?date_from=2027-06-11')->json('data'))->toBe([]);
});

it('lists goods received not invoiced as of a date per line, receipt, supplier and item', function (): void {
    $at = fn (string $asOf, string $by = 'line') => ($this->get)("receipt-vs-invoice?as_of={$asOf}&group_by={$by}");

    expect($at('2027-06-11')->json('data'))->toBe([])
        ->and($at('2027-06-12')->json('data.0'))->toMatchArray([
            'receipt_number' => $this->h->r1['number'], 'order_number' => $this->h->o1['number'], 'received_quantity' => '6.000000',
            'uninvoiced_quantity' => '6.000000', 'received_value' => '300.0000', 'uninvoiced_value' => '300.0000', 'days_open' => 0,
        ])
        // INV1 clears R1 on 13 June; R2 arrives on 14 June.
        ->and($at('2027-06-13')->json('meta.totals.uninvoiced_value'))->toBe('0.0000')
        ->and($at('2027-06-14')->json('data.0'))->toMatchArray(['receipt_number' => $this->h->r2['number'], 'uninvoiced_value' => '200.0000']);

    // Today: the return of 1 WIDGET of R1 is debited, so R1 nets to zero (left out).
    $today = $at('2027-06-15');
    expect($today->json('data'))->toHaveCount(1)
        ->and($today->json('meta.totals'))->toBe([
            'receipt_count' => 1, 'line_count' => 1, 'received_value' => '200.0000', 'invoiced_value' => '0.0000', 'returned_value' => '0.0000',
            'uninvoiced_value' => '200.0000',
        ]);

    foreach (['receipt', 'supplier', 'item'] as $by) {
        expect(Kit::sum($at('2027-06-15', $by)->json('data'), 'uninvoiced_value'))->toBe('200.0000', $by);
    }

    expect($at('2027-06-15', 'supplier')->json('data.0'))->toMatchArray(['party_code' => $this->w->party->code, 'receipt_count' => 1])
        ->and($at('2027-06-15', 'item')->json('data.0'))->toMatchArray(['item_code' => 'WIDGET', 'uninvoiced_base_quantity' => '4.000000']);

    // A draft invoice on R2 shows as in draft but is not invoiced yet.
    PurchKit::post($this->w->user, $this->w->company, "purchase-receipts/{$this->h->r2['id']}/invoice", [
        'document_date' => '2027-06-15', 'supplier_invoice_no' => 'A-D', 'lines' => [['receipt_line_id' => $this->h->r2['lines'][0]['id'], 'quantity' => '3']],
    ])->assertCreated();
    expect($at('2027-06-15')->json('data.0'))->toMatchArray(['in_draft_quantity' => '3.000000', 'uninvoiced_value' => '200.0000']);
});

it('ages payables as of a date with settlements, debit notes and reversals', function (): void {
    $at = fn (string $q) => ($this->get)("supplier-ageing?{$q}");

    $today = $at('group_by=invoice');
    $rows = Kit::by($today->json('data'), 'supplier_invoice_no');
    expect($today->json('meta.totals'))->toBe([
        'invoice_count' => 4, 'balance_local' => '792.0000', 'not_due' => '360.0000', 'days_0_30' => '432.0000', 'days_31_60' => '0.0000',
        'days_61_90' => '0.0000', 'days_over_90' => '0.0000', 'overdue' => '432.0000',
    ])->and($rows['A-1'])->toMatchArray(['payable' => '374.4000', 'settled_amount' => '100.0000', 'balance' => '274.4000', 'days_overdue' => 2, 'bucket' => 'days_0_30'])
        ->and($rows['A-S'])->toMatchArray(['payable' => '220.0000', 'balance_local' => '220.0000'])
        ->and($rows['B-1'])->toMatchArray(['currency_code' => 'USD', 'balance' => '12.0000', 'balance_local' => '360.0000', 'days_overdue' => -35, 'bucket' => 'not_due'])
        ->and(collect($today->json('data'))->firstWhere('invoice_type', 'return'))->toMatchArray(['balance' => '-62.4000', 'party_code' => $this->w->party->code]);

    // Before the settlement and the reversal: INV3 still open, INV1 not yet booked.
    expect($at('as_of=2027-06-12&group_by=invoice')->json('meta.totals.balance_local'))->toBe('480.0000')
        ->and(array_column($at('as_of=2027-06-14&group_by=invoice')->json('data'), 'supplier_invoice_no'))->toContain('A-1', 'A-3')
        ->and(Kit::by($at('as_of=2027-06-14&group_by=invoice')->json('data'), 'supplier_invoice_no')['A-1']['settled_amount'])->toBe('0.0000');

    // Buckets move with as_of: INV1 (due 13 June) is over 90 days on 30 September, INVB 72 days.
    $late = $at('as_of=2027-09-30&group_by=supplier_currency')->json('data');
    $beta = collect($late)->firstWhere('currency_code', 'USD');
    expect($beta)->toMatchArray(['balance' => '12.0000', 'days_61_90' => '12.0000', 'overdue' => '12.0000', 'balance_local' => '360.0000'])
        ->and(collect($late)->firstWhere('currency_code', 'TRY'))->toMatchArray(['days_over_90' => '432.0000', 'oldest_due_date' => '2027-06-13'])
        ->and($at('as_of=2027-08-12')->json('meta.totals'))->toMatchArray(['days_31_60' => '432.0000', 'days_0_30' => '360.0000'])
        ->and($at('as_of=2027-07-13')->json('meta.totals'))->toMatchArray(['days_0_30' => '432.0000', 'not_due' => '360.0000']);

    // The rebuilt balances today equal balance_due of the open invoices.
    $due = DB::table('purchase_invoices')->where('company_id', $this->w->company)->whereIn('status', ['booked', 'partially_paid'])
        ->get(['balance_due', 'fx_rate', 'invoice_type']);
    $expected = $due->reduce(fn (BigDecimal $c, object $i) => $c->plus(BigDecimal::of((string) $i->balance_due)->multipliedBy((string) $i->fx_rate)
        ->multipliedBy($i->invoice_type === 'return' ? -1 : 1)), BigDecimal::zero());
    expect($today->json('meta.totals.balance_local'))->toBe((string) $expected->toScale(4));
});

it('reports price variances of invoices and debit notes with order and invoice prices', function (): void {
    $lines = ($this->get)("price-variance?{$this->june}");
    expect($lines->json('data'))->toHaveCount(2)
        ->and($lines->json('data.0'))->toMatchArray([
            'source' => 'invoice', 'event' => 'booked', 'supplier_invoice_no' => 'A-1', 'order_number' => $this->h->o1['number'], 'item_code' => 'WIDGET',
            'quantity' => '6.000000', 'order_unit_price' => '50.000000', 'invoice_unit_price' => '52.000000', 'price_difference_percent' => '4.00',
            'receipt_value' => '300.0000', 'document_value' => '312.0000', 'variance_amount' => '12.0000',
        ])
        ->and($lines->json('data.1'))->toMatchArray(['source' => 'debit_note', 'receipt_value' => '-50.0000', 'document_value' => '-52.0000', 'variance_amount' => '-2.0000'])
        ->and($lines->json('meta.totals'))->toBe([
            'line_count' => 2, 'receipt_value' => '250.0000', 'document_value' => '260.0000', 'variance_amount' => '10.0000',
            'unfavourable_amount' => '12.0000', 'favourable_amount' => '-2.0000',
        ]);

    expect(($this->get)("price-variance?{$this->june}&group_by=supplier")->json('data.0'))->toMatchArray(['party_code' => $this->w->party->code, 'line_count' => 2, 'variance_amount' => '10.0000'])
        ->and(($this->get)("price-variance?{$this->june}&group_by=item")->json('data.0'))->toMatchArray(['item_code' => 'WIDGET', 'variance_amount' => '10.0000'])
        ->and(($this->get)('price-variance?date_from=2027-06-14&date_to=2027-06-30')->json('meta.totals.variance_amount'))->toBe('-2.0000');
});

it('measures return rates against receipts per supplier, item and category', function (): void {
    $suppliers = ($this->get)("return-rate?{$this->june}");
    expect($suppliers->json('data'))->toHaveCount(1)
        ->and($suppliers->json('data.0'))->toMatchArray([
            'party_code' => $this->w->party->code, 'receipt_count' => 2, 'return_count' => 1, 'received_quantity' => '10.000000', 'returned_quantity' => '1.000000',
            'quantity_rate_percent' => '10.00', 'received_value' => '500.0000', 'returned_value' => '50.0000', 'value_rate_percent' => '10.00',
        ]);

    expect(($this->get)("return-rate?{$this->june}&group_by=item")->json('data.0'))->toMatchArray(['item_code' => 'WIDGET', 'quantity_rate_percent' => '10.00'])
        ->and(($this->get)("return-rate?{$this->june}&group_by=category")->json('data.0'))->toMatchArray(['category_id' => null, 'returned_value' => '50.0000'])
        ->and(($this->get)('return-rate?date_from=2027-06-01&date_to=2027-06-13')->json('meta.totals'))->toMatchArray(['returned_value' => '0.0000', 'value_rate_percent' => '0.00']);
});

it('reports RFQ savings per RFQ, line and supplier', function (): void {
    $line = ($this->get)("rfq-savings?{$this->june}&group_by=line");
    expect($line->json('data.0'))->toMatchArray([
        'rfq_number' => 'RFQ2027000000001', 'item_code' => 'WIDGET', 'party_name' => 'Supplier A', 'party_code' => $this->w->party->code, 'quote_count' => 2,
        'awarded_unit_price' => '50.000000', 'lowest_unit_price' => '50.000000', 'highest_unit_price' => '54.000000', 'average_unit_price' => '52.000000',
        'awarded_value' => '500.0000', 'highest_value' => '540.0000', 'average_value' => '520.0000', 'savings_vs_highest' => '40.0000',
        'savings_vs_average' => '20.0000', 'premium_vs_lowest' => '0.0000', 'estimated_value' => null, 'savings_vs_estimate' => null,
    ])->and($line->json('meta.by_currency.0'))->toMatchArray(['currency_code' => 'TRY', 'savings_vs_highest' => '40.0000', 'savings_percent' => '7.41']);

    expect(($this->get)("rfq-savings?{$this->june}")->json('data.0'))->toMatchArray(['line_count' => 1, 'supplier_count' => 1, 'estimated_value' => null, 'savings_vs_highest' => '40.0000'])
        ->and(($this->get)("rfq-savings?{$this->june}&group_by=supplier")->json('data.0'))->toMatchArray(['rfq_count' => 1, 'currency_code' => 'TRY'])
        ->and(($this->get)("rfq-savings?{$this->june}&party_id={$this->h->beta->id}")->json('data'))->toBe([]);
});

it('compares awarded prices with the request estimate and a premium over the lowest quote', function (): void {
    $w = $this->w;
    $request = PurchKit::post($w->user, $w->company, 'purchase-requests', [
        'document_date' => '2027-06-14', 'lines' => [['item_id' => $w->item->id, 'quantity' => '5', 'estimated_price' => '70']],
    ])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/submit")->assertOk();
    $rfq = PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/rfq", ['document_date' => '2027-06-14', 'supplier_ids' => [$w->party->id, $this->h->beta->id]])
        ->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/send")->assertOk();
    $line = $rfq['lines'][0]['id'];
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $w->party->id, 'quotes' => [['rfq_line_id' => $line, 'unit_price' => '66']]])->assertSuccessful();
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/quotes", ['party_id' => $this->h->beta->id, 'quotes' => [['rfq_line_id' => $line, 'unit_price' => '64']]])->assertSuccessful();
    // Awarded to A (faster, dearer): 5 x 66 = 330, lowest 320, estimate 350.
    PurchKit::post($w->user, $w->company, "purchase-rfqs/{$rfq['id']}/award", ['party_id' => $w->party->id])->assertSuccessful();

    $row = collect(($this->get)('rfq-savings?date_from=2027-06-14&date_to=2027-06-14&group_by=line')->json('data'))->first();
    expect($row)->toMatchArray([
        'awarded_value' => '330.0000', 'lowest_value' => '320.0000', 'highest_value' => '330.0000', 'premium_vs_lowest' => '10.0000',
        'estimated_value' => '350.0000', 'savings_vs_estimate' => '20.0000', 'savings_vs_highest' => '0.0000',
    ]);
});

it('pages rows while totals cover the whole report', function (): void {
    $page = ($this->get)("by-supplier?{$this->june}&per_page=1&page=2");
    expect($page->json('data'))->toHaveCount(1)
        ->and($page->json('data.0.party_name'))->toBe('Supplier Beta')
        ->and($page->json('data.0.party_code'))->toBe($this->h->beta->code)
        ->and($page->json('meta.pagination'))->toBe(['current_page' => 2, 'per_page' => 1, 'total' => 2, 'last_page' => 2])
        ->and($page->json('meta.totals.net_amount'))->toBe('760.0000')
        ->and($page->json('meta.filters'))->toBe(['date_from' => '2027-06-01', 'date_to' => '2027-06-30']);
});
