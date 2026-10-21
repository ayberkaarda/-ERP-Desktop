<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Inventory\Http\Resources\StockLotResource;
use App\Modules\Inventory\Http\Resources\StockMovementResource;
use App\Modules\Inventory\Http\Resources\StockSerialResource;
use App\Modules\Inventory\Models\StockMovement;
use App\Modules\Inventory\Support\Stock;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use stdClass;

/**
 * Lots and serial units with traceability (every movement, where received and where issued).
 * Lot filters: item_id, expires_before (date), expired (bool), with_stock (bool); q on lot number.
 * Serial filters: item_id, status, warehouse_id; q on serial number.
 */
final class TraceController extends InventoryController
{
    public function lots(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $f = $this->filters($request, ['item_id' => 'uuid', 'expires_before' => 'date', 'expired' => 'bool', 'with_stock' => 'bool']);
        $like = $this->search($request);
        $query = $this->lotQuery();

        if (isset($f['item_id'])) {
            $query->where('l.item_id', $f['item_id']);
        }

        if (isset($f['expires_before'])) {
            $query->where('l.expiry_date', '<=', $f['expires_before']);
        }

        if (in_array($f['expired'] ?? '', ['1', 'true'], true)) {
            $query->where('l.expiry_date', '<', now()->format('Y-m-d'));
        }

        if (in_array($f['with_stock'] ?? '', ['1', 'true'], true)) {
            $query->where('b.on_hand', '>', 0);
        }

        if ($like !== null) {
            $query->where('l.lot_no', 'ilike', $like);
        }

        $this->sort($query, $request, ['expiry_date' => 'l.expiry_date', 'lot_no' => 'l.lot_no', 'created_at' => 'l.created_at', 'on_hand' => 'on_hand'], ['expiry_date', 'lot_no']);
        $page = $this->page($query, $request, StockLotResource::class);

        return ApiResponse::success($page['data'], $page['meta']);
    }

    public function lot(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $lot = $this->lotQuery()->where('l.id', Str::isUuid($id) ? $id : null)->first() ?? throw (new ModelNotFoundException)->setModel(StockMovement::class, [$id]);

        return ApiResponse::success((new StockLotResource($lot))->resolve($request));
    }

    /**
     * Movements of a lot in order, with received/issued totals per warehouse.
     */
    public function lotTrace(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $lot = $this->lotQuery()->where('l.id', Str::isUuid($id) ? $id : null)->first() ?? throw (new ModelNotFoundException)->setModel(StockMovement::class, [$id]);
        $movements = $this->movements()->where('m.lot_id', $lot->id)->orderBy('m.seq')->limit(5000)->get()->all();

        return ApiResponse::success([
            'lot' => (new StockLotResource($lot))->resolve($request),
            'summary' => $this->summary($movements),
            'movements' => StockMovementResource::collection($movements)->resolve($request),
        ]);
    }

    public function serials(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $f = $this->filters($request, ['item_id' => 'uuid', 'status' => 'string', 'warehouse_id' => 'uuid']);
        $like = $this->search($request);
        $query = $this->serialQuery();

        foreach (['item_id', 'status', 'warehouse_id'] as $key) {
            if (isset($f[$key])) {
                $query->where("s.{$key}", $f[$key]);
            }
        }

        if ($like !== null) {
            $query->where('s.serial_no', 'ilike', $like);
        }

        $this->sort($query, $request, ['serial_no' => 's.serial_no', 'status' => 's.status', 'created_at' => 's.created_at'], ['serial_no']);
        $page = $this->page($query, $request, StockSerialResource::class);

        return ApiResponse::success($page['data'], $page['meta']);
    }

    public function serial(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $serial = $this->serialQuery()->where('s.id', Str::isUuid($id) ? $id : null)->first() ?? throw (new ModelNotFoundException)->setModel(StockMovement::class, [$id]);
        $movements = $this->movements()->where('m.serial_id', $serial->id)->orderBy('m.seq')->get()->all();

        return ApiResponse::success([
            ...(new StockSerialResource($serial))->resolve($request),
            'movements' => StockMovementResource::collection($movements)->resolve($request),
        ]);
    }

    private function lotQuery(): Builder
    {
        $company = $this->companyId();
        $stock = DB::table('stock_balances')->where('company_id', $company)->groupBy('lot_id')->selectRaw('lot_id, sum(on_hand) as on_hand');

        return DB::table('stock_lots as l')
            ->leftJoin('items as i', 'i.id', '=', 'l.item_id')
            ->leftJoinSub($stock, 'b', 'b.lot_id', '=', 'l.id')
            ->where('l.company_id', $company)
            ->select(['l.id', 'l.item_id', 'i.code as item_code', 'i.name as item_name', 'l.lot_no', 'l.expiry_date', 'l.manufacture_date', 'l.created_at'])
            ->selectRaw('coalesce(b.on_hand, 0) as on_hand');
    }

    private function serialQuery(): Builder
    {
        return DB::table('stock_serials as s')
            ->leftJoin('items as i', 'i.id', '=', 's.item_id')
            ->leftJoin('stock_lots as l', 'l.id', '=', 's.lot_id')
            ->where('s.company_id', $this->companyId())
            ->select(['s.*', 'i.code as item_code', 'i.name as item_name', 'l.lot_no']);
    }

    private function movements(): Builder
    {
        return DB::table('stock_movements as m')
            ->leftJoin('items as i', 'i.id', '=', 'm.item_id')
            ->leftJoin('stock_lots as l', 'l.id', '=', 'm.lot_id')
            ->leftJoin('stock_serials as s', 's.id', '=', 'm.serial_id')
            ->leftJoin('stock_documents as d', 'd.id', '=', 'm.document_id')
            ->where('m.company_id', $this->companyId())
            ->select(['m.*', 'i.code as item_code', 'i.name as item_name', 'l.lot_no', 's.serial_no', 'd.number as document_number', 'd.doc_type as document_doc_type']);
    }

    /**
     * @param  array<int, stdClass>  $movements
     * @return list<array{warehouse_id: string, received: string, issued: string, on_hand: string}>
     */
    private function summary(array $movements): array
    {
        $totals = [];

        foreach ($movements as $m) {
            $w = (string) $m->warehouse_id;
            $totals[$w] ??= ['in' => Stock::dec('0'), 'out' => Stock::dec('0')];
            $totals[$w][$m->direction === 'in' ? 'in' : 'out'] = $totals[$w][$m->direction === 'in' ? 'in' : 'out']->plus((string) $m->quantity);
        }

        $rows = [];

        foreach ($totals as $w => $t) {
            $rows[] = ['warehouse_id' => $w, 'received' => Stock::qty($t['in']), 'issued' => Stock::qty($t['out']), 'on_hand' => Stock::qty($t['in']->minus($t['out']))];
        }

        return $rows;
    }
}
