<?php

declare(strict_types=1);

use App\Modules\Inventory\Services\BalanceRebuilder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

const STOCK_REPORTS = ['stock-status', 'stock-ledger', 'valuation', 'ageing', 'expiring-lots', 'abc-analysis', 'turnover', 'movement-summary'];

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company, 'MAIN')->id;
    $this->item = Inv::item($this->company, ['code' => 'A-100', 'name' => '=HYPERLINK("http://x")'])->id;
    Inv::receive($this->company, $this->wh, $this->item, '3', '1.123456', date: '2027-06-01');
    Inv::issue($this->company, $this->wh, $this->item, '1', date: '2027-06-02');
    $this->user = Actors::user(['inventory.reports.view']);
    $this->get = fn (string $uri, mixed $user = null, ?string $company = null) => Inv::as($user ?? $this->user, $company ?? $this->company)->getJson('/api/v1/inventory-reports/'.$uri);
});

it('answers 403 before validation without the report permission on every route', function (string $report, bool $export): void {
    $others = array_values(array_diff(Inv::ALL, ['inventory.reports.view']));
    $user = Actors::user($others);
    // Invalid parameters on purpose: the permission is checked first.
    $uri = $report.($export ? '/export' : '').'?as_of=not-a-date&date_from=x&days=-1&format=pdf&group_by=nope';

    ($this->get)($uri, $user)->assertForbidden();
})->with(array_merge(...array_map(fn (string $r): array => [$r => [$r, false], $r.' export' => [$r, true]], STOCK_REPORTS)));

it('serves every report and export to a holder of the permission', function (string $report): void {
    $query = $report === 'stock-ledger' ? '?item_id='.$this->item : '';
    $json = ($this->get)($report.$query)->assertOk();
    expect($json->json('meta.pagination.total'))->toBeInt();

    $csv = ($this->get)($report.'/export'.$query)->assertOk();
    expect($csv->headers->get('content-type'))->toContain('text/csv')
        ->and($csv->streamedContent())->toStartWith("\xEF\xBB\xBF");
})->with(STOCK_REPORTS);

it('grants the report permission to the accountant, viewer and warehouse roles by default', function (): void {
    $catalog = require app_path('Modules/Inventory/permissions.php');

    expect($catalog['permissions']['inventory.reports.view']['roles'])->toEqualCanonicalizing(['Warehouse', 'Accountant', 'Viewer']);

    foreach (['Accountant', 'Viewer', 'Warehouse'] as $role) {
        expect(DB::table('roles as r')->join('role_has_permissions as rp', 'rp.role_id', '=', 'r.id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('r.name', $role)->where('p.name', 'inventory.reports.view')->exists())->toBeTrue($role);
    }
});

it('rejects invalid parameters with 422', function (string $uri): void {
    ($this->get)($uri)->assertUnprocessable();
})->with([
    'ledger without item' => ['stock-ledger'],
    'ledger bad item' => ['stock-ledger?item_id=nope'],
    'bad as_of' => ['stock-status?as_of=2027-13-01'],
    'bad group' => ['stock-status?group_by=lot'],
    'bad method' => ['valuation?method=lifo'],
    'reversed range' => ['movement-summary?date_from=2027-06-10&date_to=2027-06-01'],
    'bad days' => ['expiring-lots?days=-1'],
    'bad basis' => ['abc-analysis?basis=margin'],
    'bad limit' => ['abc-analysis?a=150'],
    'bad format' => ['stock-status/export?format=pdf'],
    'per page too big' => ['stock-status?per_page=501'],
]);

it('keeps every report inside the active company', function (): void {
    $other = Actors::companyFor($this->user, ['inventory.reports.view']);
    $otherWh = Inv::warehouse($other, 'FOREIGN')->id;
    $otherItem = Inv::item($other, ['code' => 'F-1', 'tracking' => 'lot', 'has_expiry' => true])->id;
    Inv::receive($other, $otherWh, $otherItem, '50', '9', ['lotNo' => 'F', 'expiry' => '2027-06-20'], '2027-06-01');
    Inv::issue($other, $otherWh, $otherItem, '5', ['lotNo' => 'F'], '2027-06-03');

    foreach (['stock-status', 'valuation', 'ageing', 'expiring-lots', 'abc-analysis', 'turnover', 'movement-summary'] as $report) {
        $codes = array_column(($this->get)($report)->assertOk()->json('data'), 'item_code');
        expect($codes)->not->toContain('F-1');
    }

    // Another company's ids filter to nothing and its item has no kartex here.
    expect(($this->get)('stock-status?warehouse_id='.$otherWh)->json('data'))->toBe([])
        ->and(($this->get)('movement-summary?item_id='.$otherItem)->json('data'))->toBe([]);
    ($this->get)('stock-ledger?item_id='.$otherItem)->assertNotFound();
    ($this->get)('stock-ledger/export?item_id='.$otherItem)->assertNotFound();

    // The same user in the other company sees only that company.
    expect(array_column(($this->get)('stock-status', null, $other)->json('data'), 'item_code'))->toBe(['F-1'])
        ->and(($this->get)('stock-status', null, $other)->json('meta.totals.value'))->toBe('405.0000');
});

it('exports exact decimal text with formulas guarded and enforces the row cap', function (): void {
    $csv = ($this->get)('stock-ledger/export?item_id='.$this->item)->assertOk()->streamedContent();

    expect($csv)->toContain('3.000000')->toContain('3.3704')->toContain('1.1235')->toContain('2.2469');

    $status = ($this->get)('stock-status/export')->streamedContent();
    expect($status)->toContain('2.000000,1.123450,2.2469')
        ->toContain('"\'=HYPERLINK(""http://x"")"')->not->toContain(',=HYPERLINK');

    $xlsx = ($this->get)('valuation/export?format=xlsx')->assertOk();
    $path = tempnam(sys_get_temp_dir(), 'inv').'.xlsx';
    file_put_contents($path, file_get_contents($xlsx->baseResponse->getFile()->getPathname()));
    $sheet = IOFactory::load($path)->getActiveSheet();
    $headings = $sheet->rangeToArray('A1:P1')[0];
    $valueColumn = array_search('value', $headings, true);
    $cell = $sheet->getCell([(int) $valueColumn + 1, 2]);
    expect($cell->getValue())->toBe('2.2469')->and($cell->getDataType())->toBe(DataType::TYPE_STRING)
        ->and($sheet->getCell([array_search('item_name', $headings, true) + 1, 2])->getValue())->toBe('\'=HYPERLINK("http://x")');
    @unlink($path);

    config(['inventory.export_max_rows' => 1]);
    ($this->get)('stock-ledger/export?item_id='.$this->item)->assertUnprocessable();
    Inv::receive($this->company, $this->wh, Inv::item($this->company, ['code' => 'B'])->id, '1', '1');
    ($this->get)('stock-status/export')->assertUnprocessable();
    ($this->get)('stock-status')->assertOk();
});

it('keeps the reorder suggestions endpoint working', function (): void {
    $item = Inv::item($this->company, ['code' => 'R-1', 'reorder_point' => '10', 'min_stock' => '5'])->id;
    Inv::receive($this->company, $this->wh, $item, '4', '1');
    $viewer = Actors::user(['inventory.stock.view']);

    $row = collect(Inv::as($viewer, $this->company)->getJson('/api/v1/reports/reorder-suggestions')->assertOk()->json('data'))->firstWhere('item_code', 'R-1');
    expect($row)->toMatchArray(['available' => '4.000000', 'suggested_quantity' => '11.000000']);
});

it('stays fast and query-bounded on a few thousand movements and agrees with the balances', function (): void {
    $items = [];

    for ($i = 0; $i < 20; $i++) {
        $items[] = Inv::item($this->company, ['code' => sprintf('P-%02d', $i)])->id;
    }

    $second = Inv::warehouse($this->company, 'SECOND')->id;

    // Volume straight into the ledger (receipt 10, issue 4 per item, warehouse and day; a fixed
    // cost per item), then the balances rebuilt from it, as inventory:rebuild-balances does.
    $rows = [];

    for ($d = 0; $d < 75; $d++) {
        $date = (new DateTimeImmutable('2027-03-01'))->modify("+{$d} days")->format('Y-m-d');
        $wh = $d % 2 === 0 ? $this->wh : $second;

        foreach ($items as $i => $id) {
            $cost = (string) (1 + $i % 7);

            foreach ([['receipt', 'in', 10], ['issue', 'out', 4]] as [$type, $direction, $qty]) {
                $rows[] = [
                    'company_id' => $this->company, 'item_id' => $id, 'warehouse_id' => $wh, 'movement_type' => $type, 'direction' => $direction,
                    'quantity' => $qty, 'unit_cost' => $cost, 'total_cost' => $qty * (int) $cost, 'occurred_at' => $date,
                    'document_type' => 'perf', 'document_id' => (string) Str::uuid7(),
                ];
            }
        }
    }

    foreach (array_chunk($rows, 500) as $chunk) {
        DB::table('stock_movements')->insert($chunk);
    }

    app(BalanceRebuilder::class)->rebuild($this->company);
    expect(DB::table('stock_movements')->where('company_id', $this->company)->count())->toBeGreaterThanOrEqual(3000);

    foreach (STOCK_REPORTS as $report) {
        $uri = $report.($report === 'stock-ledger' ? '?item_id='.$items[0] : '');
        DB::flushQueryLog();
        DB::enableQueryLog();
        $started = microtime(true);
        ($this->get)($uri)->assertOk();
        $elapsed = microtime(true) - $started;
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        expect($queries)->toBeLessThan(40, "{$report}: {$queries} queries")
            ->and($elapsed)->toBeLessThan(10.0, "{$report}: {$elapsed}s");
    }

    $status = ($this->get)('stock-status?per_page=500')->json();
    expect($status['meta']['totals']['value'])->toBe(Inv::totalValue($this->company))
        ->and($status['meta']['pagination']['total'])->toBe(41);

    foreach ($status['data'] as $row) {
        expect($row['quantity'])->toBe(Inv::onHand($this->company, $row['item_id'], $row['warehouse_id']));
    }
});
