<?php

declare(strict_types=1);

use App\Modules\Reference\Models\ExchangeRate;
use Brick\Math\BigDecimal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sales\SalesReportKit as Kit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->h = Kit::history(['accounting.reports.view']);
    $this->w = $this->h->w;
    $this->get = fn (string $uri) => Kit::report($this->w, $uri);
    $this->tb = function (string $from, string $to): array {
        $rows = SalesKit::as($this->w->user, $this->w->company)->getJson("/api/v1/reports/trial-balance?date_from={$from}&date_to={$to}")
            ->assertOk()->json('data.rows');

        return collect($rows)->keyBy('code')->all();
    };
    // Credit movement of revenue (600) minus the debit movement of sales returns (610).
    $this->revenue = function (string $from, string $to): string {
        $rows = ($this->tb)($from, $to);
        $credit = fn (string $code): BigDecimal => isset($rows[$code]) ? BigDecimal::of($rows[$code]['credit'])->minus($rows[$code]['debit']) : BigDecimal::zero();

        return (string) $credit('600')->plus($credit('610'))->toScale(4);
    };
    $this->cogs = function (string $from, string $to): string {
        $rows = ($this->tb)($from, $to);

        return (string) (isset($rows['621']) ? BigDecimal::of($rows['621']['debit'])->minus($rows['621']['credit']) : BigDecimal::zero())->toScale(4);
    };
});

it('equals the revenue movement of the trial balance for the same period', function (string $from, string $to, string $expected): void {
    $net = ($this->get)("sales-by-period?period=day&date_from={$from}&date_to={$to}")->assertOk()->json('meta.totals.net_amount');

    expect($net)->toBe($expected)->and(($this->revenue)($from, $to))->toBe($expected);
})->with([
    'June' => ['2027-06-01', '2027-06-30', '810.0000'],
    'before the reversal and the credit note' => ['2027-06-11', '2027-06-14', '960.0000'],
    'the reversal day' => ['2027-06-15', '2027-06-15', '-150.0000'],
    'nothing yet' => ['2027-06-01', '2027-06-10', '0.0000'],
]);

it('keeps line allocations of FX invoices exact so every grouping adds up to the ledger', function (): void {
    SalesKit::in($this->w->company, fn () => ExchangeRate::factory()->create(['currency_code' => 'EUR', 'rate_date' => '2027-06-14', 'forex_buying' => '32.123456', 'forex_selling' => '32.123456']));
    $invoice = SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $this->w->party->id, 'document_date' => '2027-06-14', 'currency_code' => 'EUR',
        'lines' => [
            ['item_id' => $this->w->service->id, 'quantity' => '3', 'unit_price' => '33.33'],
            ['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10.01', 'tax_code_id' => null],
            ['item_id' => $this->w->service->id, 'quantity' => '7', 'unit_price' => '0.07'],
        ],
    ])->assertCreated()->json('data');
    $issued = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()->json('data');
    $range = 'date_from=2027-06-01&date_to=2027-06-30';
    $expected = (string) BigDecimal::of('810')->plus($issued['total_local'])->minus($issued['tax_total_local'])->toScale(4);

    $sum = fn (array $rows, string $column): string => (string) array_reduce($rows, fn (BigDecimal $c, array $r) => $c->plus($r[$column]), BigDecimal::zero())->toScale(4);
    expect(($this->get)("sales-by-period?{$range}")->json('meta.totals.net_amount'))->toBe($expected)
        ->and($sum(($this->get)("by-customer?{$range}")->json('data'), 'net_amount'))->toBe($expected)
        ->and($sum(($this->get)("by-item?{$range}")->json('data'), 'net_amount'))->toBe($expected)
        ->and($sum(($this->get)("margin?{$range}&group_by=customer")->json('data'), 'revenue'))->toBe($expected)
        ->and(($this->revenue)('2027-06-01', '2027-06-30'))->toBe($expected)
        ->and(($this->get)("sales-by-period?{$range}")->json('meta.totals.tax_amount'))
        ->toBe((string) BigDecimal::of('162')->plus($issued['tax_total_local'])->toScale(4));
});

it('takes the margin COGS from the costs the stock movements and the COGS account carry', function (): void {
    // Cancelling posted delivery D2 reverses its stock issue today.
    SalesKit::post($this->w->user, $this->w->company, "sales-deliveries/{$this->h->d2['id']}/cancel", ['reason' => 'Wrong goods'])->assertOk();

    $movements = function (string $from, string $to): string {
        $rows = DB::table('stock_movements')->where('company_id', $this->w->company)->whereBetween('occurred_at', [$from, $to])
            ->where('movement_type', '<>', 'receipt')->get(['direction', 'total_cost', 'reverses_id']);
        $cost = BigDecimal::zero();

        foreach ($rows as $row) {
            $cost = $row->direction === 'out' ? $cost->plus((string) $row->total_cost) : $cost->minus((string) $row->total_cost);
        }

        return (string) $cost->toScale(4);
    };

    foreach ([['2027-06-01', '2027-06-30', '100.0000'], ['2027-06-01', '2027-06-14', '250.0000'], ['2027-06-15', '2027-06-15', '-150.0000']] as [$from, $to, $expected]) {
        $cogs = ($this->get)("margin?date_from={$from}&date_to={$to}")->assertOk()->json('meta.totals.cogs');

        expect($cogs)->toBe($expected, "{$from}..{$to}")
            ->and($movements($from, $to))->toBe($expected)
            ->and(($this->cogs)($from, $to))->toBe($expected);
    }

    // Initial receipts are not sales; only sales documents moved stock in June apart from them.
    expect(DB::table('stock_movements')->where('company_id', $this->w->company)->where('occurred_at', '>=', '2027-06-02')->where('movement_type', 'receipt')->exists())->toBeFalse();
});
