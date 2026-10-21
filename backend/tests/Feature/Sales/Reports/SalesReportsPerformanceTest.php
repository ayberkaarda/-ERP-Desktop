<?php

declare(strict_types=1);

use App\Modules\Sales\Reports\Http\Requests\SalesReportRequest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

it('stays query-bounded and fast on a few thousand invoice lines and agrees with itself', function (): void {
    $w = SalesKit::world();
    $user = SalesKit::user(['sales.reports.view']);
    $items = [];

    for ($i = 0; $i < 20; $i++) {
        $items[] = SalesKit::item($w->company, ['code' => sprintf('P-%02d', $i), 'default_tax_code_id' => $w->vat->id], $w->unit)->id;
    }

    $parties = [];

    for ($i = 0; $i < 30; $i++) {
        $parties[] = SalesKit::party($w->company, ['name' => "Customer {$i}"])->id;
    }

    // Volume straight into the tables (drafts, then issued as the guards require): 1500 invoices of 3 lines (net 10 x line number, VAT 20%).
    $headers = [];
    $lines = [];

    for ($n = 0; $n < 1500; $n++) {
        $id = (string) Str::uuid7();
        $date = (new DateTimeImmutable('2027-01-01'))->modify('+'.($n % 160).' days')->format('Y-m-d');
        $headers[] = [
            'id' => $id, 'company_id' => $w->company, 'number' => sprintf('PERF%09d', $n), 'status' => 'draft', 'document_date' => $date,
            'party_id' => $parties[$n % 30], 'party_name' => 'Customer '.($n % 30), 'currency_code' => 'TRY', 'fx_rate' => '1', 'due_date' => $date,
            'subtotal' => '60', 'discount_total' => '0', 'tax_total' => '12', 'total' => '72',
            'subtotal_local' => '60', 'discount_total_local' => '0', 'tax_total_local' => '12', 'total_local' => '72',
            'invoice_type' => 'sale', 'journal_entry_id' => (string) Str::uuid7(), 'paid_amount' => '0', 'balance_due' => '0',
            'created_at' => now(), 'updated_at' => now(),
        ];

        for ($l = 1; $l <= 3; $l++) {
            $net = (string) (10 * $l);
            $tax = (string) (2 * $l);
            $lines[] = [
                'id' => (string) Str::uuid7(), 'company_id' => $w->company, 'document_id' => $id, 'line_no' => $l, 'item_id' => $items[($n + $l) % 20],
                'item_type' => 'stock', 'quantity' => '1', 'unit_id' => $w->unit->id, 'base_quantity' => '1', 'unit_price' => $net,
                'gross_amount' => $net, 'net_amount' => $net, 'tax_rate' => '20', 'tax_amount' => $tax, 'line_total' => (string) (12 * $l),
            ];
        }
    }

    foreach (array_chunk($headers, 500) as $chunk) {
        DB::table('sales_invoices')->insert($chunk);
    }

    foreach (array_chunk($lines, 1000) as $chunk) {
        DB::table('sales_invoice_lines')->insert($chunk);
    }

    DB::table('sales_invoices')->where('company_id', $w->company)->where('number', 'like', 'PERF%')->update(['status' => 'issued', 'balance_due' => '72']);

    $range = 'date_from=2027-01-01&date_to=2027-12-31&per_page=500';

    foreach (SalesReportRequest::reports() as $report) {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $started = microtime(true);
        SalesKit::get($user, $w->company, "sales-reports/{$report}?{$range}")->assertOk();
        $elapsed = microtime(true) - $started;
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        // Item names cost one lookup per distinct item on the page (20 here); everything else is bulk.
        expect($queries)->toBeLessThan(60, "{$report}: {$queries} queries")
            ->and($elapsed)->toBeLessThan(15.0, "{$report}: {$elapsed}s");
    }

    $period = SalesKit::get($user, $w->company, "sales-reports/sales-by-period?{$range}")->json('meta.totals');
    $customers = SalesKit::get($user, $w->company, "sales-reports/by-customer?{$range}")->json();
    $items = SalesKit::get($user, $w->company, "sales-reports/by-item?{$range}")->json('data');

    expect($period)->toMatchArray(['invoice_count' => 1500, 'net_amount' => '90000.0000', 'tax_amount' => '18000.0000'])
        ->and($customers['meta']['pagination']['total'])->toBe(30)
        ->and(array_sum(array_column($customers['data'], 'invoice_count')))->toBe(1500)
        ->and($items)->toHaveCount(20)
        ->and(array_reduce($items, fn ($c, $r) => $c->plus($r['net_amount']), SalesKit::dec('0'))->toScale(4)->__toString())->toBe('90000.0000')
        ->and(SalesKit::get($user, $w->company, 'sales-reports/customer-ageing?as_of=2027-12-31')->json('meta.totals'))
        ->toMatchArray(['invoice_count' => 1500, 'balance_local' => '108000.0000', 'days_over_90' => '108000.0000']);
});

it('reads item details in bulk for 500 distinct items, including category grouping and exports', function (): void {
    $w = SalesKit::world();
    $user = SalesKit::user(['sales.reports.view']);
    $categories = [Catalog::category($w->company, 'CAT-A')->id, Catalog::category($w->company, 'CAT-B')->id];
    $items = [];

    for ($i = 0; $i < 500; $i++) {
        $items[] = SalesKit::item($w->company, ['code' => sprintf('HC-%03d', $i), 'category_id' => $categories[$i % 2]], $w->unit)->id;
    }

    $headers = [];
    $lines = [];

    foreach ($items as $n => $item) {
        $id = (string) Str::uuid7();
        $headers[] = [
            'id' => $id, 'company_id' => $w->company, 'number' => sprintf('HC%09d', $n), 'status' => 'draft', 'document_date' => '2027-03-01',
            'party_id' => $w->party->id, 'party_name' => 'Acme', 'currency_code' => 'TRY', 'fx_rate' => '1', 'due_date' => '2027-03-01',
            'subtotal' => '10', 'discount_total' => '0', 'tax_total' => '0', 'total' => '10', 'subtotal_local' => '10', 'discount_total_local' => '0',
            'tax_total_local' => '0', 'total_local' => '10', 'invoice_type' => 'sale', 'journal_entry_id' => (string) Str::uuid7(), 'paid_amount' => '0',
            'balance_due' => '0', 'created_at' => now(), 'updated_at' => now(),
        ];
        $lines[] = [
            'id' => (string) Str::uuid7(), 'company_id' => $w->company, 'document_id' => $id, 'line_no' => 1, 'item_id' => $item, 'item_type' => 'stock',
            'quantity' => '1', 'unit_id' => $w->unit->id, 'base_quantity' => '1', 'unit_price' => '10', 'gross_amount' => '10', 'net_amount' => '10',
            'tax_rate' => '0', 'tax_amount' => '0', 'line_total' => '10',
        ];
    }

    DB::table('sales_invoices')->insert($headers);
    DB::table('sales_invoice_lines')->insert($lines);
    DB::table('sales_invoices')->where('company_id', $w->company)->where('number', 'like', 'HC%')->update(['status' => 'issued', 'balance_due' => '10']);

    $range = 'date_from=2027-01-01&date_to=2027-12-31&per_page=500';
    $uris = ["by-item?{$range}", "by-category?{$range}", "by-item/export?{$range}", "margin?{$range}&group_by=category", "margin/export?{$range}",
        "return-rate?{$range}&group_by=category", "by-customer?{$range}&category_id={$categories[0]}"];

    foreach ($uris as $uri) {
        DB::flushQueryLog();
        DB::enableQueryLog();
        SalesKit::get($user, $w->company, "sales-reports/{$uri}")->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        // 500 items cost 5 bulk reads (batches of 100), never one query per item.
        expect($queries)->toBeLessThan(40, "{$uri}: {$queries} queries");
    }

    $byCategory = SalesKit::get($user, $w->company, "sales-reports/by-category?{$range}")->json('data');
    expect(array_column($byCategory, 'net_amount', 'category_id'))->toBe([$categories[0] => '2500.0000', $categories[1] => '2500.0000'])
        ->and(array_column($byCategory, 'item_count'))->toBe([250, 250])
        ->and(SalesKit::get($user, $w->company, "sales-reports/by-item?{$range}")->json('data.499.item_code'))->toStartWith('HC-');
});
