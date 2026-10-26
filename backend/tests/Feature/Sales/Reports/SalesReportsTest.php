<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sales\SalesReportKit as Kit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->h = Kit::history();
    $this->w = $this->h->w;
    $this->get = fn (string $uri) => Kit::report($this->w, $uri);
});

it('sums sales per month with returns, reversals and FX invoices netted', function (): void {
    $json = ($this->get)('sales-by-period?date_from=2027-05-01&date_to=2027-06-30')->assertOk()->json();

    expect(array_column($json['data'], 'period'))->toBe(['2027-05', '2027-06'])
        ->and($json['data'][0]['net_amount'])->toBe('0.0000')
        ->and(Arr::except($json['data'][1], ['period', 'period_start', 'period_end']))->toBe([
            'invoice_count' => 3, 'credit_note_count' => 1, 'reversal_count' => 1,
            'sales_amount' => '910.0000', 'returns_amount' => '100.0000', 'net_amount' => '810.0000',
            'tax_amount' => '162.0000', 'total_amount' => '972.0000',
        ])
        ->and($json['data'][1]['period_start'])->toBe('2027-06-01')
        ->and($json['data'][1]['period_end'])->toBe('2027-06-30')
        ->and($json['meta']['totals']['net_amount'])->toBe('810.0000')
        ->and($json['meta']['currency'])->toBe('TRY')
        ->and($json['meta']['by_currency'])->toBe([
            ['currency_code' => 'TRY', 'sales_amount' => '300.0000', 'returns_amount' => '100.0000', 'net_amount' => '200.0000', 'net_amount_local' => '200.0000'],
            ['currency_code' => 'USD', 'sales_amount' => '20.0000', 'returns_amount' => '0.0000', 'net_amount' => '20.0000', 'net_amount_local' => '610.0000'],
        ]);
});

it('puts a reversal in the period of its reversal date and splits weeks and days', function (): void {
    $weeks = Kit::by(($this->get)('sales-by-period?period=week&date_from=2027-06-01&date_to=2027-06-30')->json('data'), 'period');

    expect(array_keys($weeks))->toBe(['2027-W22', '2027-W23', '2027-W24', '2027-W25', '2027-W26'])
        ->and($weeks['2027-W22']['period_start'])->toBe('2027-05-31')
        ->and($weeks['2027-W26']['period_end'])->toBe('2027-07-04')
        ->and($weeks['2027-W23'])->toMatchArray(['sales_amount' => '350.0000', 'returns_amount' => '0.0000', 'net_amount' => '350.0000', 'invoice_count' => 2])
        ->and($weeks['2027-W24'])->toMatchArray(['sales_amount' => '560.0000', 'returns_amount' => '100.0000', 'net_amount' => '460.0000', 'reversal_count' => 1]);

    // Up to the 14th the reversed invoice still counts; on the 15th only its reversal and the credit note.
    expect(($this->get)('sales-by-period?period=day&date_from=2027-06-11&date_to=2027-06-14')->json('meta.totals.net_amount'))->toBe('960.0000');
    expect(($this->get)('sales-by-period?period=day&date_from=2027-06-15&date_to=2027-06-15')->json('data.0'))
        ->toMatchArray(['sales_amount' => '-50.0000', 'returns_amount' => '100.0000', 'net_amount' => '-150.0000', 'tax_amount' => '-30.0000']);
});

it('excludes drafts and cancelled invoices', function (): void {
    $draft = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-14', 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '999']],
    ])->assertCreated()->json('data');
    $cancelled = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-14', 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '777']],
    ])->assertCreated()->json('data');
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$cancelled['id']}/cancel")->assertOk();

    expect($draft['status'])->toBe('draft')
        ->and(($this->get)('sales-by-period?date_from=2027-06-01&date_to=2027-06-30')->json('meta.totals.net_amount'))->toBe('810.0000');
});

it('groups by customer, item and category with shares, quantities and codes', function (): void {
    $customers = ($this->get)('by-customer?date_from=2027-06-01&date_to=2027-06-30')->assertOk()->json('data');
    expect(array_column($customers, 'party_name'))->toBe(['Beta', 'Acme'])
        ->and($customers[0])->toMatchArray(['party_id' => $this->h->beta->id, 'party_code' => $this->h->beta->code, 'net_amount' => '610.0000', 'share_percent' => '75.31', 'invoice_count' => 1])
        ->and($customers[1])->toMatchArray(['sales_amount' => '300.0000', 'returns_amount' => '100.0000', 'net_amount' => '200.0000', 'share_percent' => '24.69',
            'invoice_count' => 2, 'credit_note_count' => 1, 'reversal_count' => 1]);

    $items = Kit::by(($this->get)('by-item?date_from=2027-06-01&date_to=2027-06-30')->json('data'), 'item_code');
    expect(array_keys($items))->toBe(['SETUP', 'WIDGET'])
        ->and($items['WIDGET'])->toMatchArray([
            'item_name' => 'Widget', 'item_type' => 'stock', 'sold_quantity' => '3.000000', 'returned_quantity' => '1.000000',
            'net_quantity' => '2.000000', 'net_amount' => '200.0000', 'average_price' => '100.0000',
        ])
        ->and($items['SETUP'])->toMatchArray(['sold_quantity' => '2.000000', 'net_amount' => '610.0000', 'average_price' => '305.0000']);

    $category = Catalog::category($this->w->company, 'GOODS');
    DB::table('items')->where('id', $this->w->item->id)->update(['category_id' => $category->id]);
    $categories = ($this->get)('by-category?date_from=2027-06-01&date_to=2027-06-30')->json('data');
    expect($categories)->toHaveCount(2)
        ->and($categories[0])->toMatchArray(['category_id' => null, 'item_count' => 1, 'net_amount' => '610.0000'])
        ->and($categories[1])->toMatchArray(['category_id' => $category->id, 'item_count' => 1, 'net_amount' => '200.0000', 'share_percent' => '24.69'])
        ->and(($this->get)("by-item?category_id={$category->id}&date_from=2027-06-01&date_to=2027-06-30")->json('meta.totals.net_amount'))->toBe('200.0000');
});

it('ranks the top customers with cumulative shares and the rest', function (): void {
    $json = ($this->get)('top-customers?limit=1&date_from=2027-06-01&date_to=2027-06-30')->assertOk()->json();

    expect($json['data'])->toHaveCount(1)
        ->and($json['data'][0])->toMatchArray(['rank' => 1, 'party_name' => 'Beta', 'net_amount' => '610.0000', 'share_percent' => '75.31', 'cumulative_share_percent' => '75.31'])
        ->and($json['meta']['others'])->toBe(['customer_count' => 1, 'net_amount' => '200.0000', 'share_percent' => '24.69']);
});

it('applies the customer, currency, item and warehouse filters', function (): void {
    $range = 'date_from=2027-06-01&date_to=2027-06-30';

    expect(($this->get)("by-customer?{$range}&currency_code=USD")->json('data.0.party_name'))->toBe('Beta')
        ->and(($this->get)("by-customer?{$range}&currency_code=USD")->json('data'))->toHaveCount(1)
        ->and(($this->get)("sales-by-period?{$range}&party_id={$this->w->party->id}")->json('meta.totals.net_amount'))->toBe('200.0000')
        ->and(($this->get)("by-item?{$range}&item_id={$this->w->item->id}")->json('data'))->toHaveCount(1)
        ->and(($this->get)("margin?{$range}&item_id={$this->w->item->id}")->json('meta.totals'))->toMatchArray(['revenue' => '200.0000', 'cogs' => '200.0000'])
        ->and(($this->get)("margin?{$range}&group_by=warehouse&warehouse_id={$this->w->wh->id}")->json('meta.totals.cogs'))->toBe('200.0000')
        ->and(($this->get)("margin?{$range}&warehouse_id=".fake()->uuid())->json('meta.totals'))->toMatchArray(['revenue' => '0.0000', 'cogs' => '0.0000']);
});

it('computes the margin from revenue and the recorded stock cost per item, customer and month', function (): void {
    $range = 'date_from=2027-06-01&date_to=2027-06-30';
    $json = ($this->get)("margin?{$range}")->assertOk()->json();
    $items = Kit::by($json['data'], 'item_code');

    expect($json['meta']['totals'])->toBe(['revenue' => '810.0000', 'cogs' => '200.0000', 'gross_margin' => '610.0000', 'margin_percent' => '75.31'])
        ->and($items['WIDGET'])->toMatchArray(['revenue' => '200.0000', 'cogs' => '200.0000', 'gross_margin' => '0.0000', 'margin_percent' => '0.00',
            'invoiced_quantity' => '2.000000', 'delivered_quantity' => '4.000000'])
        ->and($items['SETUP'])->toMatchArray(['revenue' => '610.0000', 'cogs' => '0.0000', 'margin_percent' => '100.00']);

    $customers = Kit::by(($this->get)("margin?{$range}&group_by=customer")->json('data'), 'party_name');
    expect($customers['Acme'])->toMatchArray(['revenue' => '200.0000', 'cogs' => '100.0000', 'gross_margin' => '100.0000', 'margin_percent' => '50.00'])
        ->and($customers['Beta'])->toMatchArray(['revenue' => '610.0000', 'cogs' => '100.0000', 'gross_margin' => '510.0000', 'margin_percent' => '83.61']);

    expect(($this->get)("margin?{$range}&group_by=month")->json('data'))->toBe([
        ['period' => '2027-06', 'revenue' => '810.0000', 'cogs' => '200.0000', 'gross_margin' => '610.0000', 'margin_percent' => '75.31'],
    ]);
});

it('measures return rates by value and quantity', function (): void {
    $json = ($this->get)('return-rate?date_from=2027-06-01&date_to=2027-06-30')->assertOk()->json();
    $items = Kit::by($json['data'], 'item_code');

    expect($json['data'][0]['item_code'])->toBe('WIDGET')
        ->and($items['WIDGET'])->toMatchArray(['sold_quantity' => '3.000000', 'returned_quantity' => '1.000000', 'quantity_rate_percent' => '33.33',
            'sales_amount' => '300.0000', 'returns_amount' => '100.0000', 'value_rate_percent' => '33.33', 'credit_note_count' => 1])
        ->and($items['SETUP'])->toMatchArray(['returns_amount' => '0.0000', 'value_rate_percent' => '0.00'])
        ->and($json['meta']['totals'])->toBe(['sales_amount' => '910.0000', 'returns_amount' => '100.0000', 'value_rate_percent' => '10.99'])
        ->and(Kit::by(($this->get)('return-rate?group_by=customer&date_from=2027-06-01&date_to=2027-06-30')->json('data'), 'party_name')['Acme'])
        ->toMatchArray(['sales_amount' => '300.0000', 'returns_amount' => '100.0000', 'value_rate_percent' => '33.33']);
});

it('lists the open order backlog by line, order, customer and item', function (): void {
    DB::table('sales_orders')->where('id', $this->h->o1['id'])->update(['requested_delivery_date' => '2027-06-05']);
    $json = ($this->get)('open-orders')->assertOk()->json();

    expect($json['meta']['totals'])->toBe(['order_count' => 2, 'line_count' => 3, 'open_value_local' => '560.0000'])
        ->and($json['data'])->toHaveCount(3)
        ->and($json['data'][0])->toMatchArray(['order_id' => $this->h->o1['id'], 'item_code' => 'WIDGET', 'days_late' => 10, 'quantity' => '5.000000',
            'delivered_quantity' => '3.000000', 'invoiced_quantity' => '3.000000', 'open_quantity' => '2.000000', 'open_value' => '200.0000', 'open_value_local' => '200.0000'])
        ->and($json['data'][1])->toMatchArray(['item_code' => 'SETUP', 'item_type' => 'service', 'open_quantity' => '1.000000', 'open_value' => '200.0000'])
        ->and($json['data'][2])->toMatchArray(['order_id' => $this->h->o2['id'], 'party_name' => 'Beta', 'open_quantity' => '2.000000', 'open_value' => '160.0000', 'days_late' => 0]);

    $customers = Kit::by(($this->get)('open-orders?group_by=customer')->json('data'), 'party_name');
    expect($customers['Acme'])->toMatchArray(['party_code' => $this->w->party->code, 'order_count' => 1, 'line_count' => 2, 'open_value_local' => '400.0000'])
        ->and($customers['Beta'])->toMatchArray(['party_code' => $this->h->beta->code, 'order_count' => 1, 'line_count' => 1, 'open_value_local' => '160.0000']);
    expect(Kit::by(($this->get)('open-orders?group_by=item')->json('data'), 'item_code')['WIDGET'])
        ->toMatchArray(['order_count' => 2, 'open_base_quantity' => '4.000000', 'open_value_local' => '360.0000'])
        ->and(($this->get)('open-orders?group_by=order')->json('data.0'))->toMatchArray(['order_id' => $this->h->o1['id'], 'line_count' => 2, 'open_value' => '400.0000'])
        ->and(($this->get)('open-orders?date_from=2027-06-11')->json('data'))->toBe([]);

    // Closing an order takes it out of the backlog.
    SalesKit::post($this->w->user, $this->w->company, "sales-orders/{$this->h->o2['id']}/close")->assertOk();
    expect(($this->get)('open-orders')->json('meta.totals.open_value_local'))->toBe('400.0000');
});

it('rebuilds delivered-not-invoiced quantities as of a date', function (): void {
    $now = ($this->get)('delivery-vs-invoice')->assertOk()->json();
    expect($now['meta']['as_of'])->toBe('2027-06-15')
        ->and($now['data'])->toHaveCount(1)
        ->and($now['data'][0])->toMatchArray(['delivery_id' => $this->h->d2['id'], 'party_name' => 'Beta', 'item_code' => 'WIDGET', 'quantity' => '2.000000',
            'invoiced_quantity' => '0.000000', 'uninvoiced_quantity' => '2.000000', 'uninvoiced_value' => '160.0000', 'uninvoiced_value_local' => '160.0000',
            'uninvoiced_cost' => '100.0000', 'days_open' => 3, 'order_number' => $this->h->o2['number']]);

    // Before INV1 (13 June) delivery D1 was not invoiced either.
    $before = ($this->get)('delivery-vs-invoice?as_of=2027-06-12')->json();
    expect($before['meta']['totals'])->toBe(['delivery_count' => 2, 'line_count' => 2, 'uninvoiced_value_local' => '460.0000', 'uninvoiced_cost' => '250.0000'])
        ->and(($this->get)('delivery-vs-invoice?as_of=2027-06-11')->json('data'))->toBe([])
        ->and(Kit::by(($this->get)('delivery-vs-invoice?as_of=2027-06-12&group_by=customer')->json('data'), 'party_name')['Acme'])
        ->toMatchArray(['delivery_count' => 1, 'line_count' => 1, 'uninvoiced_value_local' => '300.0000', 'uninvoiced_cost' => '150.0000']);

    // A draft invoice is shown but does not invoice.
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$this->h->d2['id']}/invoice", [
        'document_date' => '2027-06-15', 'lines' => [['delivery_line_id' => $this->h->d2['lines'][0]['id'], 'quantity' => '1']],
    ])->assertCreated();
    expect(($this->get)('delivery-vs-invoice')->json('data.0'))->toMatchArray(['uninvoiced_quantity' => '2.000000', 'in_draft_quantity' => '1.000000']);
});

it('stops counting a delivery from the day it is cancelled', function (): void {
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$this->h->d2['id']}/cancel", ['reason' => 'Wrong goods'])->assertOk();

    expect(($this->get)('delivery-vs-invoice')->json('data'))->toBe([])
        ->and(($this->get)('delivery-vs-invoice?as_of=2027-06-14')->json('meta.totals.uninvoiced_cost'))->toBe('100.0000');
});

it('ages receivables as of a date from issue, reversal and settlement data', function (): void {
    $now = ($this->get)('customer-ageing')->assertOk()->json();
    expect($now['meta']['totals'])->toBe([
        'invoice_count' => 3, 'balance_local' => '872.0000',
        'not_due' => '732.0000', 'days_0_30' => '140.0000', 'days_31_60' => '0.0000', 'days_61_90' => '0.0000', 'days_over_90' => '0.0000', 'overdue' => '140.0000',
    ])->and(Kit::by($now['data'], 'party_name')['Acme'])->toMatchArray(['invoice_count' => 2, 'balance_local' => '140.0000', 'days_0_30' => '140.0000', 'overdue' => '140.0000'])
        ->and(Kit::by($now['data'], 'party_name')['Beta'])->toMatchArray(['balance_local' => '732.0000', 'not_due' => '732.0000', 'oldest_due_date' => '2027-07-20']);

    $invoices = Kit::by(($this->get)('customer-ageing?group_by=invoice')->json('data'), 'invoice_id');
    expect($invoices[$this->h->inv1['id']])->toMatchArray(['total' => '360.0000', 'settled_amount' => '100.0000', 'balance' => '260.0000', 'balance_local' => '260.0000', 'bucket' => 'days_0_30'])
        ->and($invoices[$this->h->crn['id']])->toMatchArray(['invoice_type' => 'return', 'balance' => '-120.0000', 'balance_local' => '-120.0000'])
        ->and($invoices[$this->h->inv2['id']])->toMatchArray(['currency_code' => 'USD', 'balance' => '24.0000', 'balance_local' => '732.0000', 'days_overdue' => -35, 'bucket' => 'not_due'])
        ->and($invoices)->not->toHaveKey($this->h->inv3['id']);

    // The day before: the settlement and the credit note did not exist yet, the reversed invoice was open.
    $before = Kit::by(($this->get)('customer-ageing?as_of=2027-06-14&group_by=invoice')->json('data'), 'invoice_id');
    expect(array_keys($before))->toEqualCanonicalizing([$this->h->inv1['id'], $this->h->inv2['id'], $this->h->inv3['id']])
        ->and($before[$this->h->inv1['id']]['balance'])->toBe('360.0000')
        ->and($before[$this->h->inv3['id']])->toMatchArray(['balance' => '60.0000', 'days_overdue' => 3]);

    $late = ($this->get)('customer-ageing?as_of=2027-09-30')->json('meta.totals');
    expect($late)->toMatchArray(['days_61_90' => '732.0000', 'days_over_90' => '140.0000', 'not_due' => '0.0000']);

    $currency = Kit::by(($this->get)('customer-ageing?group_by=customer_currency')->json('data'), 'party_name')['Beta'];
    expect($currency)->toMatchArray(['currency_code' => 'USD', 'balance' => '24.0000', 'not_due' => '24.0000', 'balance_local' => '732.0000']);

    // Today the rebuilt balances equal the stored balance_due.
    foreach ([$this->h->inv1, $this->h->inv2, $this->h->crn] as $inv) {
        $stored = (string) DB::table('sales_invoices')->where('id', $inv['id'])->value('balance_due');
        expect(ltrim($invoices[$inv['id']]['balance'], '-'))->toBe($stored);
    }
});

it('measures quote conversion once per revision chain', function (): void {
    $quote = fn (string $price) => SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-10', 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => $price]],
    ])->assertCreated()->json('data');
    $won = $quote('100');
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$won['id']}/send")->assertOk();
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$won['id']}/accept")->assertOk();
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$won['id']}/convert", ['document_date' => '2027-06-14'])->assertCreated();
    $lost = $quote('300');
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$lost['id']}/send")->assertOk();
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$lost['id']}/reject", ['reason' => 'Too expensive'])->assertOk();
    $quote('50');
    $revised = $quote('70');
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$revised['id']}/send")->assertOk();
    SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$revised['id']}/revise")->assertCreated();

    $json = ($this->get)('quote-conversion?date_from=2027-06-01&date_to=2027-06-30')->assertOk()->json();
    expect($json['data'])->toHaveCount(1)
        ->and($json['data'][0])->toMatchArray([
            'quote_count' => 2, 'converted_count' => 1, 'rejected_count' => 1, 'open_count' => 0, 'cancelled_count' => 0,
            'quoted_value' => '400.0000', 'converted_value' => '100.0000', 'conversion_rate_percent' => '50.00',
            'value_conversion_rate_percent' => '25.00', 'average_days_to_convert' => '4.0',
        ])
        ->and(($this->get)('quote-conversion?group_by=month&date_from=2027-06-01&date_to=2027-06-30')->json('data.0.period'))->toBe('2027-06')
        ->and(($this->get)('quote-conversion?group_by=customer&date_from=2027-06-01&date_to=2027-06-30')->json('data.0'))
        ->toMatchArray(['party_name' => 'Acme', 'party_code' => $this->w->party->code, 'quote_count' => 2]);
});

it('paginates rows and keeps totals for the whole report', function (): void {
    $json = ($this->get)('by-customer?per_page=1&page=2&date_from=2027-06-01&date_to=2027-06-30')->assertOk()->json();

    expect($json['data'])->toHaveCount(1)
        ->and($json['data'][0]['party_name'])->toBe('Acme')
        ->and($json['meta']['pagination'])->toBe(['current_page' => 2, 'per_page' => 1, 'total' => 2, 'last_page' => 2])
        ->and($json['meta']['totals']['net_amount'])->toBe('810.0000');
});

it('adds every grouping up to the line rows and the totals', function (string $report, array $groups, array $columns): void {
    $sum = fn (array $rows, string $column): string => (string) array_reduce($rows, fn ($c, array $r) => $c->plus($r[$column]), SalesKit::dec('0'))->toScale(4);
    $lines = ($this->get)("{$report}?as_of=2027-06-12")->json();

    foreach ($groups as $group) {
        $rows = ($this->get)("{$report}?as_of=2027-06-12&group_by={$group}")->json('data');

        foreach ($columns as $column) {
            expect($sum($rows, $column))->toBe($sum($lines['data'], $column), "{$group}.{$column}")
                ->and($sum($rows, $column))->toBe($lines['meta']['totals'][$column], "{$group}.{$column} meta");
        }
    }
})->with([
    'delivery-vs-invoice' => ['delivery-vs-invoice', ['delivery', 'customer', 'item'], ['uninvoiced_value_local', 'uninvoiced_cost']],
    'open-orders' => ['open-orders', ['order', 'customer', 'item'], ['open_value_local']],
]);
