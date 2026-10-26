<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Inventory\Http\Resources\StockBalanceResource;
use App\Modules\Inventory\Models\StockMovement;
use App\Modules\Inventory\Support\Export;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\RoundingMode;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use stdClass;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Stock status. group_by=warehouse (default: item x warehouse, value and average from the
 * warehouse valuation), item (all warehouses) or detail (item x warehouse x location x lot).
 * Filters: item_id, warehouse_id, location_id, lot_id, category_id, include_zero; q on item
 * code/name. Sorts: item_code, warehouse_code, on_hand, reserved, available, value.
 */
final class StockBalanceController extends InventoryController
{
    private const array FILTERS = [
        'item_id' => 'uuid', 'warehouse_id' => 'uuid', 'location_id' => 'uuid', 'lot_id' => 'uuid', 'category_id' => 'uuid', 'include_zero' => 'bool',
    ];

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $page = $this->page($this->query($request), $request, StockBalanceResource::class);

        return ApiResponse::success($page['data'], $page['meta']);
    }

    public function export(Request $request): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', StockMovement::class);
        $format = $this->format($request);
        $query = $this->query($request);
        Export::assertWithinCap(DB::query()->fromSub(clone $query, 'x')->count());
        $headings = ['item_code', 'item_name', 'warehouse_code', 'location_code', 'lot_no', 'expiry_date', 'on_hand', 'reserved', 'available', 'avg_cost', 'value'];
        $rows = [];

        foreach (StockBalanceResource::collection($query->get()->all())->resolve($request) as $row) {
            $rows[] = array_map(static fn (string $h): ?string => is_scalar($row[$h] ?? null) ? (string) $row[$h] : null, $headings);
        }

        return Export::download('stock-balances', $format, $headings, $rows);
    }

    /**
     * Stock of one item: totals, per warehouse and per lot.
     */
    public function item(Request $request, string $id, ItemLookup $items): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $item = $items->find($id) ?? throw (new ModelNotFoundException)->setModel(StockMovement::class, [$id]);
        $company = $this->companyId();

        $warehouses = DB::table('stock_valuations as v')
            ->leftJoin('warehouses as w', 'w.id', '=', 'v.warehouse_id')
            ->leftJoinSub($this->reservedByPair($company), 'r', fn ($j) => $j->on('r.item_id', '=', 'v.item_id')->on('r.warehouse_id', '=', 'v.warehouse_id'))
            ->where('v.company_id', $company)->where('v.item_id', $item->id)
            ->where(fn ($q) => $q->where('v.quantity', '<>', 0)->orWhere('v.value', '<>', 0)->orWhere('r.reserved', '>', 0))
            ->orderBy('w.code')
            ->get(['v.warehouse_id', 'w.code as warehouse_code', 'w.name as warehouse_name', 'v.quantity', 'v.value', 'v.avg_cost', 'r.reserved']);

        $lots = DB::table('stock_balances as b')->join('stock_lots as l', 'l.id', '=', 'b.lot_id')
            ->where('b.company_id', $company)->where('b.item_id', $item->id)
            ->groupBy('b.lot_id', 'l.lot_no', 'l.expiry_date')->havingRaw('sum(b.on_hand) <> 0 or sum(b.reserved) <> 0')
            ->orderByRaw('l.expiry_date nulls last')->orderBy('l.lot_no')
            ->get(['b.lot_id', 'l.lot_no', 'l.expiry_date', DB::raw('sum(b.on_hand) as on_hand'), DB::raw('sum(b.reserved) as reserved')]);

        $onHand = Stock::dec('0');
        $reserved = Stock::dec('0');
        $value = Stock::dec('0');
        $rows = [];

        foreach ($warehouses as $w) {
            $q = Stock::dec((string) $w->quantity);
            $r = Stock::dec(is_scalar($w->reserved) ? (string) $w->reserved : '0');
            $onHand = $onHand->plus($q);
            $reserved = $reserved->plus($r);
            $value = $value->plus((string) $w->value);
            $rows[] = [
                'warehouse_id' => (string) $w->warehouse_id, 'warehouse_code' => is_string($w->warehouse_code) ? $w->warehouse_code : null,
                'warehouse_name' => is_string($w->warehouse_name) ? $w->warehouse_name : null,
                'on_hand' => Stock::qty($q), 'reserved' => Stock::qty($r), 'available' => Stock::qty($q->minus($r)),
                'avg_cost' => (string) Stock::dec((string) $w->avg_cost)->toScale(6), 'value' => (string) Stock::money((string) $w->value),
            ];
        }

        return ApiResponse::success([
            'item_id' => $item->id,
            'item_code' => $item->code,
            'item_name' => $item->name,
            'base_unit_id' => $item->baseUnitId,
            'on_hand' => Stock::qty($onHand),
            'reserved' => Stock::qty($reserved),
            'available' => Stock::qty($onHand->minus($reserved)),
            'avg_cost' => $onHand->isPositive() ? (string) $value->dividedBy($onHand, 6, RoundingMode::HalfEven) : '0.000000',
            'value' => (string) Stock::money($value),
            'warehouses' => $rows,
            'lots' => array_values($lots->map(static fn (stdClass $l): array => [
                'lot_id' => (string) $l->lot_id, 'lot_no' => (string) $l->lot_no, 'expiry_date' => is_string($l->expiry_date) ? $l->expiry_date : null,
                'on_hand' => Stock::qty((string) $l->on_hand), 'reserved' => Stock::qty((string) $l->reserved),
                'available' => Stock::qty(Stock::dec((string) $l->on_hand)->minus((string) $l->reserved)),
            ])->all()),
        ]);
    }

    private function query(Request $request): Builder
    {
        $valid = Validator::make($request->query(), ['group_by' => ['sometimes', 'in:warehouse,item,detail']])->validate();
        $group = is_string($valid['group_by'] ?? null) ? $valid['group_by'] : 'warehouse';
        $f = $this->filters($request, self::FILTERS);
        $like = $this->search($request);
        $company = $this->companyId();
        $includeZero = in_array($f['include_zero'] ?? '0', ['1', 'true'], true);

        $query = match ($group) {
            'detail' => $this->detail($company, $f),
            'item' => $this->byItem($company, $f),
            default => $this->byWarehouse($company, $f),
        };

        $query->where('i.company_id', $company);

        if (isset($f['category_id'])) {
            $query->where('i.category_id', $f['category_id']);
        }

        if ($like !== null) {
            $query->where(fn ($w) => $w->where('i.code', 'ilike', $like)->orWhere('i.name', 'ilike', $like));
        }

        if (! $includeZero) {
            $query->havingRaw('sum(x.on_hand) <> 0 or sum(x.reserved) <> 0');
        }

        $this->sort($query, $request, [
            'item_code' => 'i.code', 'warehouse_code' => 'warehouse_code', 'on_hand' => 'on_hand', 'reserved' => 'reserved',
            'available' => 'available', 'value' => 'value',
        ], $group === 'item' ? ['item_code'] : ['item_code', 'warehouse_code']);

        return $query;
    }

    /**
     * @param  array<string, string>  $f
     */
    private function byWarehouse(string $company, array $f): Builder
    {
        return DB::table('stock_balances as x')
            ->join('items as i', 'i.id', '=', 'x.item_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'x.warehouse_id')
            ->leftJoin('stock_valuations as v', fn ($j) => $j->on('v.company_id', '=', 'x.company_id')->on('v.item_id', '=', 'x.item_id')->on('v.warehouse_id', '=', 'x.warehouse_id'))
            ->where('x.company_id', $company)
            ->tap(fn (Builder $q) => $this->keyFilters($q, $f))
            ->groupBy('x.item_id', 'i.code', 'i.name', 'i.base_unit_id', 'x.warehouse_id', 'w.code', 'w.name', 'v.avg_cost', 'v.value')
            ->select(['x.item_id', 'i.code as item_code', 'i.name as item_name', 'i.base_unit_id', 'x.warehouse_id', 'w.code as warehouse_code', 'w.name as warehouse_name'])
            ->selectRaw('sum(x.on_hand) as on_hand, sum(x.reserved) as reserved, sum(x.on_hand) - sum(x.reserved) as available')
            ->selectRaw('coalesce(v.avg_cost, 0) as avg_cost, '.(isset($f['location_id']) || isset($f['lot_id']) ? 'sum(x.value)' : 'coalesce(v.value, 0)').' as value');
    }

    /**
     * @param  array<string, string>  $f
     */
    private function byItem(string $company, array $f): Builder
    {
        $values = DB::table('stock_valuations')->where('company_id', $company)
            ->when(isset($f['warehouse_id']), fn ($q) => $q->where('warehouse_id', $f['warehouse_id']))
            ->groupBy('item_id')->selectRaw('item_id, sum(value) as value');

        return DB::table('stock_balances as x')
            ->join('items as i', 'i.id', '=', 'x.item_id')
            ->leftJoinSub($values, 'v', 'v.item_id', '=', 'x.item_id')
            ->where('x.company_id', $company)
            ->tap(fn (Builder $q) => $this->keyFilters($q, $f))
            ->groupBy('x.item_id', 'i.code', 'i.name', 'i.base_unit_id', 'v.value')
            ->select(['x.item_id', 'i.code as item_code', 'i.name as item_name', 'i.base_unit_id'])
            ->selectRaw('null as warehouse_code, sum(x.on_hand) as on_hand, sum(x.reserved) as reserved, sum(x.on_hand) - sum(x.reserved) as available')
            ->selectRaw('case when sum(x.on_hand) > 0 then round(coalesce(v.value, 0) / sum(x.on_hand), 6) else 0 end as avg_cost')
            ->selectRaw((isset($f['location_id']) || isset($f['lot_id']) ? 'sum(x.value)' : 'coalesce(v.value, 0)').' as value');
    }

    /**
     * @param  array<string, string>  $f
     */
    private function detail(string $company, array $f): Builder
    {
        return DB::table('stock_balances as x')
            ->join('items as i', 'i.id', '=', 'x.item_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'x.warehouse_id')
            ->leftJoin('locations as loc', 'loc.id', '=', 'x.location_id')
            ->leftJoin('stock_lots as l', 'l.id', '=', 'x.lot_id')
            ->where('x.company_id', $company)
            ->tap(fn (Builder $q) => $this->keyFilters($q, $f))
            ->groupBy('x.item_id', 'i.code', 'i.name', 'i.base_unit_id', 'x.warehouse_id', 'w.code', 'w.name', 'x.location_id', 'loc.code', 'x.lot_id', 'l.lot_no', 'l.expiry_date', 'x.avg_cost', 'x.value')
            ->select([
                'x.item_id', 'i.code as item_code', 'i.name as item_name', 'i.base_unit_id', 'x.warehouse_id', 'w.code as warehouse_code', 'w.name as warehouse_name',
                'x.location_id', 'loc.code as location_code', 'x.lot_id', 'l.lot_no', 'l.expiry_date', 'x.avg_cost', 'x.value',
            ])
            ->selectRaw('sum(x.on_hand) as on_hand, sum(x.reserved) as reserved, sum(x.on_hand) - sum(x.reserved) as available');
    }

    /**
     * @param  array<string, string>  $f
     */
    private function keyFilters(Builder $q, array $f): void
    {
        foreach (['item_id', 'warehouse_id', 'location_id', 'lot_id'] as $key) {
            if (isset($f[$key])) {
                $q->where("x.{$key}", $f[$key]);
            }
        }
    }

    private function reservedByPair(string $company): Builder
    {
        return DB::table('stock_balances')->where('company_id', $company)->groupBy('item_id', 'warehouse_id')
            ->selectRaw('item_id, warehouse_id, sum(reserved) as reserved');
    }
}
