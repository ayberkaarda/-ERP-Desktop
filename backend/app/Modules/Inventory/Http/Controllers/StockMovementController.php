<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Inventory\Enums\Direction;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Inventory\Http\Resources\StockMovementResource;
use App\Modules\Inventory\Models\StockMovement;
use App\Modules\Inventory\Support\Export;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The stock ledger, newest first, with cursor pagination: pass meta.next_cursor as cursor to get
 * the next page (order=asc reads oldest first). Filters: item_id, warehouse_id, location_id,
 * lot_id, serial_id, document_id, movement_type, direction, date_from, date_to; q on item code/name
 * and document number.
 */
final class StockMovementController extends InventoryController
{
    public const int MAX_PER_PAGE = 200;

    private const array FILTERS = [
        'item_id' => 'uuid', 'warehouse_id' => 'uuid', 'location_id' => 'uuid', 'lot_id' => 'uuid', 'serial_id' => 'uuid', 'document_id' => 'uuid',
        'movement_type' => 'string', 'direction' => 'string', 'date_from' => 'date', 'date_to' => 'date',
    ];

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $input = Validator::make($request->query(), [
            'cursor' => ['sometimes', 'integer', 'min:0'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'order' => ['sometimes', 'in:asc,desc'],
        ])->validate();
        $perPage = isset($input['per_page']) ? (int) $input['per_page'] : 50;
        $asc = ($input['order'] ?? 'desc') === 'asc';
        $query = $this->query($request);

        if (isset($input['cursor'])) {
            $query->where('m.seq', $asc ? '>' : '<', (int) $input['cursor']);
        }

        $rows = $query->orderBy('m.seq', $asc ? 'asc' : 'desc')->limit($perPage + 1)->get()->all();
        $more = count($rows) > $perPage;
        $rows = array_slice($rows, 0, $perPage);
        $last = end($rows);

        return ApiResponse::success(StockMovementResource::collection($rows)->resolve($request), [
            'per_page' => $perPage,
            'next_cursor' => $more && is_object($last) ? (int) $last->seq : null,
        ]);
    }

    public function export(Request $request): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', StockMovement::class);
        $format = $this->format($request);
        $query = $this->query($request)->orderBy('m.seq');
        Export::assertWithinCap((clone $query)->count());
        $headings = ['seq', 'occurred_at', 'movement_type', 'direction', 'item_code', 'item_name', 'warehouse_id', 'location_id', 'lot_no', 'serial_no', 'quantity', 'signed_quantity', 'unit_cost', 'total_cost', 'document_number', 'journal_entry_id'];
        $rows = [];

        foreach (StockMovementResource::collection($query->get()->all())->resolve($request) as $row) {
            $rows[] = array_map(static fn (string $h): ?string => is_scalar($row[$h] ?? null) ? (string) $row[$h] : null, $headings);
        }

        return Export::download('stock-movements', $format, $headings, $rows);
    }

    private function query(Request $request): Builder
    {
        $f = $this->filters($request, self::FILTERS);
        Validator::make($f, [
            'movement_type' => ['sometimes', Rule::in(MovementType::values())],
            'direction' => ['sometimes', Rule::in(Direction::values())],
        ])->validate();
        $like = $this->search($request);

        $query = DB::table('stock_movements as m')
            ->leftJoin('items as i', 'i.id', '=', 'm.item_id')
            ->leftJoin('stock_lots as l', 'l.id', '=', 'm.lot_id')
            ->leftJoin('stock_serials as s', 's.id', '=', 'm.serial_id')
            ->leftJoin('stock_documents as d', 'd.id', '=', 'm.document_id')
            ->where('m.company_id', $this->companyId())
            ->select(['m.*', 'i.code as item_code', 'i.name as item_name', 'l.lot_no', 's.serial_no', 'd.number as document_number', 'd.doc_type as document_doc_type']);

        foreach (['item_id', 'warehouse_id', 'location_id', 'lot_id', 'serial_id', 'document_id', 'movement_type', 'direction'] as $key) {
            if (isset($f[$key])) {
                $query->where("m.{$key}", $f[$key]);
            }
        }

        if (isset($f['date_from'])) {
            $query->where('m.occurred_at', '>=', $f['date_from']);
        }

        if (isset($f['date_to'])) {
            $query->where('m.occurred_at', '<=', $f['date_to']);
        }

        if ($like !== null) {
            $query->where(fn ($w) => $w->where('i.code', 'ilike', $like)->orWhere('i.name', 'ilike', $like)->orWhere('d.number', 'ilike', $like));
        }

        return $query;
    }
}
