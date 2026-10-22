<?php

declare(strict_types=1);

use App\Modules\Purchasing\Contracts\SupplierPerformance;
use Brick\Math\BigDecimal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Purchasing\Reports\PurchReportKit as Kit;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->h = Kit::history();
    $this->w = $this->h->w;
    $this->get = fn (string $uri) => Kit::report($this->w, $uri);
    // SQL of every query a request runs, lowercased.
    $this->queries = function (string $uri, int $status = 200): array {
        DB::flushQueryLog();
        DB::enableQueryLog();
        ($this->get)($uri)->assertStatus($status);
        $sql = array_map(fn (array $q): string => strtolower($q['query']), DB::getQueryLog());
        DB::disableQueryLog();

        return $sql;
    };
});

it('reads only the requested page of rows or groups in SQL', function (string $uri): void {
    $sql = ($this->queries)($uri);

    // One windowed read of the page; no chunked scan of the whole report.
    expect(collect($sql)->filter(fn (string $q): bool => str_contains($q, 'limit 1 offset 0'))->count())->toBeGreaterThanOrEqual(1, $uri)
        ->and(collect($sql)->filter(fn (string $q): bool => (bool) preg_match('/limit (500|1000)\b/', $q))->all())->toBe([], $uri);
})->with([
    'open orders lines' => ['open-orders?per_page=1'],
    'open orders per item' => ['open-orders?group_by=item&per_page=1'],
    'GRNI lines' => ['receipt-vs-invoice?as_of=2027-06-14&per_page=1'],
    'GRNI per supplier' => ['receipt-vs-invoice?group_by=supplier&per_page=1'],
    'ageing invoices' => ['supplier-ageing?group_by=invoice&per_page=1'],
    'ageing per supplier' => ['supplier-ageing?per_page=1'],
    'price variance lines' => ['price-variance?date_from=2027-06-01&date_to=2027-06-30&per_page=1'],
    'price variance per item' => ['price-variance?date_from=2027-06-01&date_to=2027-06-30&group_by=item&per_page=1'],
    'RFQ savings lines' => ['rfq-savings?date_from=2027-06-01&date_to=2027-06-30&group_by=line&per_page=1'],
]);

it('pages SQL reports with the whole report in totals and pagination', function (): void {
    $page = ($this->get)('supplier-ageing?group_by=invoice&per_page=2&page=2')->assertOk();
    $all = ($this->get)('supplier-ageing?group_by=invoice')->assertOk();

    expect($page->json('data'))->toBe(array_slice($all->json('data'), 2, 2))
        ->and($page->json('meta.pagination'))->toBe(['current_page' => 2, 'per_page' => 2, 'total' => 4, 'last_page' => 2])
        ->and($page->json('meta.totals'))->toBe($all->json('meta.totals'));
});

it('refuses an export above the cap before reading its rows', function (): void {
    config(['purchasing.export_max_rows' => 1]);

    // Two variance lines in June: refused after counting them, no row read (a read takes cap + 1 rows).
    $sql = ($this->queries)('price-variance/export?date_from=2027-06-01&date_to=2027-06-30', 422);
    expect(collect($sql)->filter(fn (string $q): bool => (bool) preg_match('/limit (2|500|1000)\b/', $q))->all())->toBe([])
        ->and(collect($sql)->filter(fn (string $q): bool => str_contains($q, 'purchase_invoice_lines') && str_contains($q, 'count('))->count())->toBeGreaterThanOrEqual(1);

    // Grouped in memory: stops at the second item.
    ($this->get)('by-item/export?date_from=2027-06-01&date_to=2027-06-30')->assertUnprocessable();
    ($this->get)('return-rate/export?date_from=2027-06-01&date_to=2027-06-30&group_by=item')->assertOk();
    ($this->get)('price-variance/export?date_from=2027-06-01&date_to=2027-06-30&group_by=supplier')->assertOk();
});

it('dates supplier price variance like the price variance report, the contract included', function (): void {
    $w = $this->w;
    // O3: 2 WIDGET at 50 received 14 June, invoiced at 55 (variance 10) on 14 June, reversed on 2 July.
    $o3 = PurchKit::approvedOrder($w, [[$w->item->id, '2', '50']]);
    $receipt = PurchKit::receive($w, $o3['id'], [$o3['lines'][0]['id'] => '2'], '2027-06-14');
    $invoice = PurchKit::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/invoice", [
        'document_date' => '2027-06-14', 'supplier_invoice_no' => 'A-V', 'lines' => [['receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '2', 'unit_price' => '55']],
    ])->assertCreated()->json('data');
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk();
    PurchKit::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/reverse", ['reason' => 'Wrong price', 'date' => '2027-07-02'])->assertOk();

    // June: INV1 +12, debit note -2, A-V +10 (reversed later); July: the reversal -10.
    foreach ([['2027-06-01', '2027-06-30', '20.00'], ['2027-07-01', '2027-07-31', '-10.00']] as [$from, $to, $expected]) {
        $range = "date_from={$from}&date_to={$to}";
        $report = Kit::by(($this->get)("supplier-performance?{$range}")->json('data'), 'party_id')[$w->party->id];
        $variance = Kit::by(($this->get)("price-variance?{$range}&group_by=supplier")->json('data'), 'party_id')[$w->party->id];
        $contract = PurchKit::in($w->company, fn () => app(SupplierPerformance::class)->forParty($w->company, $w->party->id, new DateTimeImmutable($from), new DateTimeImmutable($to)));

        expect($report['price_variance_total'])->toBe($expected, $from)
            ->and($contract->priceVarianceTotal)->toBe($expected, $from)
            ->and(BigDecimal::of($variance['variance_amount'])->toScale(2)->__toString())->toBe($expected, $from);
    }
});

it('keeps an earlier return rate when a receipt is cancelled in a later period', function (): void {
    $w = $this->w;
    // R2 (4 WIDGET, 14 June) cancelled with its stock reversal dated 5 July.
    PurchKit::post($w->user, $w->company, "purchase-receipts/{$this->h->r2['id']}/cancel", ['reason' => 'Wrong goods', 'date' => '2027-07-05'])->assertOk();
    $june = 'date_from=2027-06-01&date_to=2027-06-30';

    // June still received 10 and returned 1: 10 %, not 1 of 6.
    expect(($this->get)("return-rate?{$june}")->json('data.0'))->toMatchArray([
        'receipt_count' => 2, 'received_quantity' => '10.000000', 'returned_quantity' => '1.000000', 'quantity_rate_percent' => '10.00',
        'received_value' => '500.0000', 'value_rate_percent' => '10.00',
    ])->and(($this->get)('return-rate?date_from=2027-07-01&date_to=2027-07-31')->json('data.0'))
        ->toMatchArray(['receipt_count' => 0, 'received_quantity' => '-4.000000', 'received_value' => '-200.0000'])
        ->and(($this->get)('return-rate?date_from=2027-06-01&date_to=2027-07-31')->json('meta.totals'))
        ->toMatchArray(['received_quantity' => '6.000000', 'returned_quantity' => '1.000000']);

    $report = Kit::by(($this->get)("supplier-performance?{$june}")->json('data'), 'party_id')[$w->party->id];
    $contract = PurchKit::in($w->company, fn () => app(SupplierPerformance::class)->forParty($w->company, $w->party->id, new DateTimeImmutable('2027-06-01'), new DateTimeImmutable('2027-06-30')));
    expect($report)->toMatchArray(['receipt_lines' => 2, 'received_quantity' => '10.000000', 'return_rate' => '0.1000', 'on_time_rate' => '0.5000'])
        ->and($contract->returnRate)->toBe('0.1000')
        ->and($contract->onTimeRate)->toBe('0.5000');
});
