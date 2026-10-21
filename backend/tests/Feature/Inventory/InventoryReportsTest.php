<?php

declare(strict_types=1);

use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Enums\DocumentType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company, 'MAIN')->id;
    $this->wh2 = Inv::warehouse($this->company, 'SIDE')->id;
    $this->item = Inv::item($this->company, ['code' => 'A-100', 'name' => 'Widget'])->id;
    $this->user = Actors::user(['inventory.reports.view']);
    $this->report = fn (string $path, array $query = []) => Inv::as($this->user, $this->company)
        ->getJson('/api/v1/inventory-reports/'.$path.($query === [] ? '' : '?'.http_build_query($query)));
});

/**
 * The worked example of both methods: 10 @ 10, 5 @ 16, issue 6, 3 @ 20.
 */
function stockReportExample(object $t): void
{
    Inv::receive($t->company, $t->wh, $t->item, '10', '10', date: '2027-06-01');
    Inv::receive($t->company, $t->wh, $t->item, '5', '16', date: '2027-06-02');
    Inv::issue($t->company, $t->wh, $t->item, '6', date: '2027-06-03');
    Inv::receive($t->company, $t->wh, $t->item, '3', '20', date: '2027-06-04');
}

it('rebuilds the stock status as of today equal to the balances and as of an earlier date from the movements', function (): void {
    $other = Inv::item($this->company, ['code' => 'B-200'])->id;
    stockReportExample($this);
    Inv::receive($this->company, $this->wh2, $other, '7', '3.5', date: '2027-06-05');
    Inv::post($this->company, DocumentType::Transfer, $this->wh, [Inv::line($this->item, '2')], '2027-06-08', target: $this->wh2);
    Inv::issue($this->company, $this->wh2, $other, '1.25', date: '2027-06-12');

    $rows = collect(($this->report)('stock-status')->assertOk()->json('data'));
    $stored = DB::table('stock_valuations')->where('company_id', $this->company)->where('quantity', '<>', 0)->get();

    expect($rows)->toHaveCount($stored->count());

    foreach ($stored as $v) {
        $row = $rows->first(fn (array $r): bool => $r['item_id'] === $v->item_id && $r['warehouse_id'] === $v->warehouse_id);
        expect($row['quantity'])->toBe((string) $v->quantity)->and($row['value'])->toBe((string) $v->value)
            ->and($row['quantity'])->toBe(Inv::onHand($this->company, $v->item_id, $v->warehouse_id));
    }

    $response = ($this->report)('stock-status', ['as_of' => '2027-06-02']);
    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0'))->toMatchArray(['item_code' => 'A-100', 'warehouse_code' => 'MAIN', 'quantity' => '15.000000', 'avg_cost' => '12.000000', 'value' => '180.0000'])
        ->and($response->json('meta.totals.value'))->toBe('180.0000')
        ->and($response->json('meta.as_of'))->toBe('2027-06-02');

    // By warehouse: value only; by item: across warehouses.
    $byWarehouse = ($this->report)('stock-status', ['group_by' => 'warehouse'])->json('data');
    expect(array_column($byWarehouse, 'warehouse_code'))->toBe(['MAIN', 'SIDE'])
        ->and($byWarehouse[0]['quantity'])->toBeNull()
        ->and(($this->report)('stock-status', ['group_by' => 'item', 'item_id' => $this->item])->json('data.0.quantity'))->toBe('12.000000')
        ->and(($this->report)('stock-status')->json('meta.totals.value'))->toBe(Inv::totalValue($this->company));
});

it('groups the stock status by category including sub-categories', function (): void {
    $root = Catalog::category($this->company, 'ROOT');
    $child = Catalog::category($this->company, 'CHILD', $root);
    $inChild = Inv::item($this->company, ['code' => 'C-1', 'category_id' => $child->id])->id;
    $inRoot = Inv::item($this->company, ['code' => 'C-2', 'category_id' => $root->id])->id;
    Inv::receive($this->company, $this->wh, $inChild, '2', '5');
    Inv::receive($this->company, $this->wh, $inRoot, '1', '7');
    Inv::receive($this->company, $this->wh, $this->item, '1', '100');

    $filtered = ($this->report)('stock-status', ['category_id' => $root->id])->json('data');
    $grouped = ($this->report)('stock-status', ['group_by' => 'category'])->json('data');

    expect(array_column($filtered, 'item_code'))->toBe(['C-1', 'C-2'])
        ->and(array_map(fn (array $r): array => [$r['category_code'], $r['item_count'], $r['value']], $grouped))
        ->toBe([['CHILD', 1, '10.0000'], ['ROOT', 1, '7.0000'], [null, 1, '100.0000']]);
});

it('values the worked moving average example booked and simulates FIFO on the same movements', function (): void {
    stockReportExample($this);

    $booked = ($this->report)('valuation')->assertOk();
    // (100 + 80) / 15 = 12; issue 6 x 12 = 72; (108 + 60) / 12 = 14
    expect($booked->json('data.0'))->toMatchArray(['quantity' => '12.000000', 'avg_cost' => '14.000000', 'value' => '168.0000'])
        ->and($booked->json('meta'))->toMatchArray(['method' => 'moving_average', 'company_method' => 'moving_average', 'basis' => 'booked'])
        ->and($booked->json('meta.totals.value'))->toBe(Books::balance($this->company, '153'));

    // FIFO on the same movements: 4 x 10 + 5 x 16 + 3 x 20 = 180
    $fifo = ($this->report)('valuation', ['method' => 'fifo']);
    expect($fifo->json('data.0'))->toMatchArray(['quantity' => '12.000000', 'avg_cost' => '15.000000', 'value' => '180.0000'])
        ->and($fifo->json('meta.basis'))->toBe('simulated');

    // As of a past date the booked valuation equals the stock account balance on that date.
    foreach (['2027-06-01' => '100.0000', '2027-06-02' => '180.0000', '2027-06-03' => '108.0000'] as $date => $value) {
        expect(($this->report)('valuation', ['as_of' => $date])->json('meta.totals.value'))->toBe($value)
            ->and(Books::balance($this->company, '153', $date))->toBe($value);
    }
});

it('values the worked FIFO example booked and simulates the moving average', function (): void {
    Inv::fifo($this->company);
    stockReportExample($this);

    $booked = ($this->report)('valuation');
    expect($booked->json('data.0'))->toMatchArray(['quantity' => '12.000000', 'value' => '180.0000'])
        ->and($booked->json('meta'))->toMatchArray(['method' => 'fifo', 'basis' => 'booked'])
        ->and($booked->json('meta.totals.value'))->toBe(Books::balance($this->company, '153'))
        ->and(($this->report)('valuation', ['method' => 'moving_average'])->json('data.0'))->toMatchArray(['value' => '168.0000', 'avg_cost' => '14.000000']);
});

it('ages the stock by the newest receipts under the moving average', function (): void {
    Inv::receive($this->company, $this->wh, $this->item, '10', '10', date: '2027-03-01'); // 106 days
    Inv::receive($this->company, $this->wh, $this->item, '10', '12', date: '2027-04-20'); // 56 days
    Inv::receive($this->company, $this->wh, $this->item, '10', '14', date: '2027-06-10'); // 5 days
    Inv::issue($this->company, $this->wh, $this->item, '15', date: '2027-06-12');
    $old = Inv::item($this->company, ['code' => 'Z-OLD'])->id;
    Inv::receive($this->company, $this->wh, $old, '4', '2.5', date: '2027-04-01'); // 75 days

    $response = ($this->report)('ageing')->assertOk();
    $row = collect($response->json('data'))->firstWhere('item_code', 'A-100');

    // 15 left at the average 12: the newest 10 (0-30 days) and 5 of the April receipt (31-60).
    expect($row)->toMatchArray([
        'quantity' => '15.000000', 'value' => '180.0000',
        'qty_0_30' => '10.000000', 'value_0_30' => '120.0000', 'qty_31_60' => '5.000000', 'value_31_60' => '60.0000',
        'qty_61_90' => '0.000000', 'value_61_90' => '0.0000', 'qty_over_90' => '0.000000', 'value_over_90' => '0.0000',
    ])
        ->and(collect($response->json('data'))->firstWhere('item_code', 'Z-OLD'))->toMatchArray(['qty_61_90' => '4.000000', 'value_61_90' => '10.0000'])
        ->and($response->json('meta.basis'))->toBe('receipts')
        ->and($response->json('meta.totals.value'))->toBe('190.0000');

    // As of 30 April: 10 + 10 on hand, average 11; the March receipt is 60 days old then.
    $past = collect(($this->report)('ageing', ['as_of' => '2027-04-30'])->json('data'))->firstWhere('item_code', 'A-100');
    expect($past)->toMatchArray(['qty_0_30' => '10.000000', 'value_0_30' => '110.0000', 'qty_31_60' => '10.000000', 'value_31_60' => '110.0000', 'value' => '220.0000']);
});

it('ages FIFO stock by its open layers and leaves reversed receipts out', function (): void {
    Inv::fifo($this->company);
    Inv::receive($this->company, $this->wh, $this->item, '10', '10', date: '2027-03-01');
    Inv::receive($this->company, $this->wh, $this->item, '10', '12', date: '2027-04-20');
    Inv::receive($this->company, $this->wh, $this->item, '10', '14', date: '2027-06-10');
    Inv::issue($this->company, $this->wh, $this->item, '15', date: '2027-06-12');

    $layers = ($this->report)('ageing');
    // Layers left: 5 @ 12 (April) and 10 @ 14 (June).
    expect($layers->json('meta.basis'))->toBe('layers')
        ->and($layers->json('data.0'))->toMatchArray(['qty_0_30' => '10.000000', 'value_0_30' => '140.0000', 'qty_31_60' => '5.000000', 'value_31_60' => '60.0000', 'value' => '200.0000']);

    // Before the issue (as of 11 June) all three layers were still whole.
    $receipts = ($this->report)('ageing', ['as_of' => '2027-06-11']);
    expect($receipts->json('meta.basis'))->toBe('layers')
        ->and($receipts->json('data.0'))->toMatchArray(['value_0_30' => '140.0000', 'qty_31_60' => '10.000000', 'value_31_60' => '120.0000', 'qty_over_90' => '10.000000', 'value_over_90' => '100.0000', 'value' => '360.0000']);
});

it('lists lots expiring within the window with expired ones flagged', function (): void {
    $lotItem = Inv::item($this->company, ['code' => 'L-1', 'tracking' => 'lot', 'has_expiry' => true])->id;
    Inv::receive($this->company, $this->wh, $lotItem, '3', '2', ['lotNo' => 'OLD', 'expiry' => '2027-06-10']);
    Inv::receive($this->company, $this->wh, $lotItem, '5', '2', ['lotNo' => 'SOON', 'expiry' => '2027-07-01']);
    Inv::receive($this->company, $this->wh, $lotItem, '7', '2', ['lotNo' => 'LATER', 'expiry' => '2027-09-01']);
    Inv::receive($this->company, $this->wh, $lotItem, '1', '2', ['lotNo' => 'GONE', 'expiry' => '2027-06-20']);
    Inv::issue($this->company, $this->wh, $lotItem, '1', ['lotNo' => 'GONE']);

    $window = ($this->report)('expiring-lots')->assertOk();
    expect(array_column($window->json('data'), 'lot_no'))->toBe(['OLD', 'SOON'])
        ->and($window->json('data.0'))->toMatchArray(['days_to_expiry' => -5, 'expired' => true, 'on_hand' => '3.000000', 'value' => '6.0000'])
        ->and($window->json('data.1'))->toMatchArray(['days_to_expiry' => 16, 'expired' => false, 'available' => '5.000000'])
        ->and($window->json('meta'))->toMatchArray(['days' => 30, 'until' => '2027-07-15'])
        ->and($window->json('meta.totals'))->toBe(['lots' => 2, 'expired' => 1, 'value' => '16.0000'])
        ->and(array_column(($this->report)('expiring-lots', ['include_expired' => 'false'])->json('data'), 'lot_no'))->toBe(['SOON'])
        ->and(array_column(($this->report)('expiring-lots', ['days' => 90])->json('data'), 'lot_no'))->toBe(['OLD', 'SOON', 'LATER']);
});

it('classifies items A, B and C by consumption value', function (): void {
    $items = [];

    foreach (['X' => '500', 'Y' => '300', 'Z' => '150', 'W' => '50'] as $code => $qty) {
        $items[$code] = Inv::item($this->company, ['code' => $code])->id;
        Inv::receive($this->company, $this->wh, $items[$code], '1000', '1', date: '2027-05-01');
        Inv::issue($this->company, $this->wh, $items[$code], $qty, date: '2027-06-05');
    }

    // A reversed issue does not count as consumption.
    $issue = Inv::issue($this->company, $this->wh, $items['W'], '100', date: '2027-06-06');
    Inv::in($this->company, fn () => app(StockService::class)->reverse($issue->documentId, new DateTimeImmutable('2027-06-07'), 'mistake'));
    Inv::receive($this->company, $this->wh, $this->item, '5', '9'); // stock, but no consumption

    $response = ($this->report)('abc-analysis', ['date_from' => '2027-06-01', 'date_to' => '2027-06-15'])->assertOk();

    expect(array_map(fn (array $r): array => [$r['rank'], $r['item_code'], $r['class'], $r['value'], $r['share'], $r['cumulative_share']], $response->json('data')))->toBe([
        [1, 'X', 'A', '500.0000', '50.0000', '50.0000'],
        [2, 'Y', 'A', '300.0000', '30.0000', '80.0000'],
        [3, 'Z', 'B', '150.0000', '15.0000', '95.0000'],
        [4, 'W', 'C', '50.0000', '5.0000', '100.0000'],
    ])
        ->and($response->json('meta.totals.classes.A'))->toBe(['items' => 2, 'value' => '800.0000', 'share' => '80.0000'])
        ->and($response->json('meta.totals.value'))->toBe('1000.0000');

    // Other limits move the classes; stock value as the basis ranks by what is left.
    expect(array_column(($this->report)('abc-analysis', ['date_from' => '2027-06-01', 'a' => 50, 'b' => 90])->json('data'), 'class'))->toBe(['A', 'B', 'B', 'C'])
        ->and(array_column(($this->report)('abc-analysis', ['basis' => 'stock_value'])->json('data'), 'item_code'))->toBe(['W', 'Z', 'Y', 'X', 'A-100']);
});

it('computes turnover and days on hand from opening, closing and consumption', function (): void {
    Inv::receive($this->company, $this->wh, $this->item, '1000', '1', date: '2027-05-01');
    Inv::issue($this->company, $this->wh, $this->item, '500', date: '2027-06-05');
    $idle = Inv::item($this->company, ['code' => 'IDLE'])->id;
    Inv::receive($this->company, $this->wh, $idle, '10', '3', date: '2027-05-01');

    $response = ($this->report)('turnover', ['date_from' => '2027-06-01', 'date_to' => '2027-06-15'])->assertOk();
    $row = collect($response->json('data'))->firstWhere('item_code', 'A-100');

    // average (1000 + 500) / 2 = 750; 500 / 750 = 0.6667 times; 750 x 15 / 500 = 22.50 days
    expect($row)->toMatchArray([
        'opening_quantity' => '1000.000000', 'opening_value' => '1000.0000', 'closing_quantity' => '500.000000', 'closing_value' => '500.0000',
        'consumed_quantity' => '500.000000', 'consumed_value' => '500.0000', 'average_value' => '750.00000', 'turnover' => '0.6667', 'days_on_hand' => '22.50',
    ])
        ->and(collect($response->json('data'))->firstWhere('item_code', 'IDLE'))->toMatchArray(['turnover' => '0.0000', 'days_on_hand' => null])
        ->and($response->json('meta'))->toMatchArray(['days' => 15])
        ->and($response->json('meta.totals'))->toMatchArray(['opening_value' => '1030.0000', 'closing_value' => '530.0000', 'consumed_value' => '500.0000', 'average_value' => '780.00000', 'turnover' => '0.6410', 'days_on_hand' => '23.40']);
});

it('prints a kartex with opening, running balances across pages and closing', function (): void {
    Inv::receive($this->company, $this->wh, $this->item, '10', '10', date: '2027-05-20');
    stockReportExample($this);
    Inv::post($this->company, DocumentType::Transfer, $this->wh, [Inv::line($this->item, '2')], '2027-06-08', target: $this->wh2);

    $query = ['item_id' => $this->item, 'date_from' => '2027-06-01', 'date_to' => '2027-06-15'];
    $all = ($this->report)('stock-ledger', $query)->assertOk();

    // Opening 10 @ 10 (100); after 10 @ 10 and 5 @ 16 the average is (200 + 80) / 25 = 11.2.
    expect($all->json('meta.opening'))->toBe(['quantity' => '10.000000', 'value' => '100.0000', 'avg_cost' => '10.000000'])
        ->and(array_column($all->json('data'), 'balance_quantity'))->toBe(['20.000000', '25.000000', '19.000000', '22.000000', '20.000000', '22.000000'])
        ->and($all->json('data.1'))->toMatchArray(['quantity_in' => '5.000000', 'value_in' => '80.0000', 'balance_value' => '280.0000', 'balance_avg_cost' => '11.200000'])
        ->and($all->json('data.2'))->toMatchArray(['movement_type' => 'issue', 'quantity_out' => '6.000000', 'value_out' => '67.2000', 'warehouse_code' => 'MAIN'])
        ->and($all->json('meta.totals'))->toBe(['quantity_in' => '20.000000', 'quantity_out' => '8.000000', 'value_in' => '264.8000', 'value_out' => '92.0000'])
        ->and($all->json('meta.closing'))->toMatchArray(['quantity' => '22.000000', 'value' => '272.8000'])
        ->and($all->json('meta.item'))->toMatchArray(['code' => 'A-100', 'name' => 'Widget']);

    $page = ($this->report)('stock-ledger', [...$query, 'per_page' => 2, 'page' => 2]);
    expect(array_column($page->json('data'), 'balance_quantity'))->toBe(['19.000000', '22.000000'])
        ->and($page->json('meta.pagination'))->toBe(['current_page' => 2, 'per_page' => 2, 'total' => 6, 'last_page' => 3]);

    // One warehouse only: the transfer out is the last line, closing equals the stored valuation.
    $main = ($this->report)('stock-ledger', [...$query, 'warehouse_id' => $this->wh]);
    expect($main->json('meta.closing.quantity'))->toBe(Inv::valuation($this->company, $this->item, $this->wh)['quantity'])
        ->and($main->json('meta.closing.value'))->toBe(Inv::valuation($this->company, $this->item, $this->wh)['value']);
});

it('summarises movements per item and warehouse with movement type totals', function (): void {
    Inv::receive($this->company, $this->wh, $this->item, '10', '10', date: '2027-05-20');
    stockReportExample($this);
    Inv::post($this->company, DocumentType::Transfer, $this->wh, [Inv::line($this->item, '2')], '2027-06-08', target: $this->wh2);

    $response = ($this->report)('movement-summary', ['date_from' => '2027-06-01'])->assertOk();
    $main = collect($response->json('data'))->firstWhere('warehouse_code', 'MAIN');
    $side = collect($response->json('data'))->firstWhere('warehouse_code', 'SIDE');

    expect($main)->toMatchArray([
        'opening_quantity' => '10.000000', 'opening_value' => '100.0000', 'in_quantity' => '18.000000', 'in_value' => '240.0000',
        'out_quantity' => '8.000000', 'closing_quantity' => '20.000000',
    ])
        ->and($side)->toMatchArray(['opening_quantity' => '0.000000', 'in_quantity' => '2.000000', 'closing_quantity' => '2.000000'])
        ->and(Inv::valuation($this->company, $this->item, $this->wh)['value'])->toBe($main['closing_value'])
        ->and(collect($response->json('meta.by_type'))->firstWhere('movement_type', 'receipt'))->toMatchArray(['direction' => 'in', 'movements' => 3, 'value' => '240.0000'])
        ->and($response->json('meta.totals.closing_value'))->toBe(Inv::totalValue($this->company));
});

it('keeps the FIFO receipt date across transfers and reversals in dated ageing', function (): void {
    Inv::fifo($this->company);
    Inv::receive($this->company, $this->wh, $this->item, '10', '5', date: '2027-02-01');
    Inv::post($this->company, DocumentType::Transfer, $this->wh, [Inv::line($this->item, '10')], '2027-06-14', target: $this->wh2);
    $other = Inv::item($this->company, ['code' => 'B-200'])->id;
    Inv::receive($this->company, $this->wh, $other, '10', '3', date: '2027-02-01');
    $issue = Inv::issue($this->company, $this->wh, $other, '4', date: '2027-06-10');
    Inv::in($this->company, fn () => app(StockService::class)->reverse($issue->documentId, new DateTimeImmutable('2027-06-12'), 'mistake'));

    $rows = collect(($this->report)('ageing', ['as_of' => '2027-06-14'])->json('data'));
    $moved = $rows->first(fn (array $r): bool => $r['item_code'] === 'A-100' && $r['warehouse_code'] === 'SIDE');
    $returned = $rows->firstWhere('item_code', 'B-200');

    expect($moved)->toMatchArray(['qty_0_30' => '0.000000', 'qty_over_90' => '10.000000', 'value_over_90' => '50.0000'])
        ->and($returned)->toMatchArray(['qty_0_30' => '0.000000', 'qty_over_90' => '10.000000', 'value_over_90' => '30.0000'])
        ->and(collect(($this->report)('ageing', ['as_of' => '2027-06-11'])->json('data'))->firstWhere('item_code', 'B-200'))
        ->toMatchArray(['qty_over_90' => '6.000000', 'value_over_90' => '18.0000', 'quantity' => '6.000000']);
});

it('rebuilds FIFO layers at as_of without later-dated receipts or consumption', function (): void {
    Inv::fifo($this->company);
    Inv::receive($this->company, $this->wh, $this->item, '10', '5', date: '2027-02-01');
    Inv::receive($this->company, $this->wh, $this->item, '10', '7', date: '2027-06-20');
    Inv::issue($this->company, $this->wh, $this->item, '5', date: '2027-06-25');

    expect(($this->report)('ageing')->json('data.0'))->toMatchArray([
        'quantity' => '10.000000', 'value' => '50.0000', 'qty_0_30' => '0.000000', 'qty_over_90' => '10.000000', 'value_over_90' => '50.0000',
    ]);
});

it('simulates FIFO in the ledger layer order, a backdated receipt first', function (): void {
    Inv::receive($this->company, $this->wh, $this->item, '1', '20', date: '2027-06-10');
    Inv::receive($this->company, $this->wh, $this->item, '1', '10', date: '2027-06-01');
    Inv::issue($this->company, $this->wh, $this->item, '1', date: '2027-06-12');

    expect(($this->report)('valuation')->json('data.0.value'))->toBe('15.0000')
        ->and(($this->report)('valuation', ['method' => 'fifo'])->json('data.0.value'))->toBe('20.0000');
});

it('classifies ABC on exact shares, not rounded percentages', function (): void {
    foreach (['BIG' => '7999999', 'SMALL' => '2000001'] as $code => $qty) {
        $id = Inv::item($this->company, ['code' => $code])->id;
        Inv::receive($this->company, $this->wh, $id, $qty, '1', date: '2027-05-01');
        Inv::issue($this->company, $this->wh, $id, $qty, date: '2027-06-05');
    }

    // The share before SMALL is 79.99999 %: below 80, so SMALL is still A.
    expect(array_column(($this->report)('abc-analysis', ['date_from' => '2027-06-01'])->json('data'), 'class'))->toBe(['A', 'A']);
});

it('derives turnover from the exact average and lets row averages add up to the total', function (): void {
    foreach (['T-1', 'T-2'] as $code) {
        $id = Inv::item($this->company, ['code' => $code])->id;
        Inv::receive($this->company, $this->wh, $id, '1', '0.0001', date: '2027-05-01');
        Inv::issue($this->company, $this->wh, $id, '1', date: '2027-06-01');
    }

    $response = ($this->report)('turnover', ['date_from' => '2027-06-01', 'date_to' => '2027-06-01']);

    // average 0.00005; 0.0001 / 0.00005 = 2 times; 0.00005 x 1 day / 0.0001 = 0.5 days
    expect($response->json('data.0'))->toMatchArray(['average_value' => '0.00005', 'turnover' => '2.0000', 'days_on_hand' => '0.50'])
        ->and($response->json('meta.totals'))->toMatchArray(['average_value' => '0.00010', 'turnover' => '2.0000', 'days_on_hand' => '0.50']);
});
