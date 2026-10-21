<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Inventory\Http\Requests\CountsRequest;
use App\Modules\Inventory\Http\Requests\ImportLinesRequest;
use App\Modules\Inventory\Http\Requests\PostDocumentRequest;
use App\Modules\Inventory\Http\Requests\ReverseDocumentRequest;
use App\Modules\Inventory\Http\Requests\StockDocumentRequest;
use App\Modules\Inventory\Http\Resources\StockDocumentResource;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\StockDocumentLine;
use App\Modules\Inventory\Services\Ledger\PostOptions;
use App\Modules\Inventory\Services\Ledger\StockLedger;
use App\Modules\Inventory\Services\LineImport;
use App\Modules\Inventory\Services\StockDocuments;
use App\Modules\Inventory\Support\Export;
use App\Modules\Inventory\Support\Messages;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use stdClass;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Filters: doc_type, status, warehouse_id, target_warehouse_id, source_type (ListQuery) and
 * date_from, date_to, item_id; q on number/reason/notes.
 */
final class StockDocumentController extends InventoryController
{
    private const array CUSTOM = ['date_from', 'date_to', 'item_id'];

    public function __construct(
        private readonly StockDocuments $documents,
        private readonly StockLedger $ledger,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', StockDocument::class);
        [$request, $custom] = $this->customFilters($request, self::CUSTOM);
        $query = $this->filtered(StockDocument::query()->withCount('lines'), $custom);

        if ($request->query('sort') === null) {
            $query->orderByDesc('document_date')->orderByDesc('created_at');
        }

        return ApiResponse::paginated(
            ListQuery::for(
                $query,
                $request,
                ['document_date', 'number', 'created_at', 'posted_at', 'doc_type', 'status'],
                ['doc_type', 'type' => 'doc_type', 'status', 'warehouse_id', 'target_warehouse_id', 'source_type'],
                ['number', 'reason', 'notes'],
            ),
            StockDocumentResource::class,
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', StockDocument::class);
        $doc = StockDocument::query()->with('lines')->findOrFail($id);
        Gate::authorize('view', $doc);

        $audit = $doc->activitiesAsSubject()->latest()->limit(100)->get()->map(static fn (Model $a): array => [
            'event' => $a->getAttribute('event'),
            'description' => $a->getAttribute('description'),
            'causer_id' => $a->getAttribute('causer_id'),
            'created_at' => $a->getAttribute('created_at') instanceof Carbon ? $a->getAttribute('created_at')->toIso8601String() : null,
        ])->values()->all();

        return ApiResponse::success([...$this->resolve(new StockDocumentResource($doc), $request), 'audit' => $audit]);
    }

    public function store(StockDocumentRequest $request): JsonResponse
    {
        $doc = $this->documents->create($request->validated(), $this->actor($request));

        return ApiResponse::created($this->resolve(new StockDocumentResource($doc->load('lines')), $request));
    }

    public function update(StockDocumentRequest $request, string $id): JsonResponse
    {
        $doc = StockDocument::query()->findOrFail($id);
        Gate::authorize('update', $doc);
        $doc = $this->documents->update($doc, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new StockDocumentResource($doc->load('lines')), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', StockDocument::class);
        $doc = StockDocument::query()->findOrFail($id);
        Gate::authorize('delete', $doc);
        $this->documents->delete($doc, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }

    public function counts(CountsRequest $request, string $id): JsonResponse
    {
        $doc = StockDocument::query()->findOrFail($id);
        Gate::authorize('update', $doc);
        /** @var list<array<string, mixed>> $counts */
        $counts = array_values((array) $request->validated('counts', []));
        /** @var list<array<string, mixed>> $add */
        $add = array_values((array) $request->validated('add', []));
        $doc = $this->documents->counts($doc, $request->integer('version'), $counts, $add);

        return ApiResponse::success($this->resolve(new StockDocumentResource($doc->load('lines')), $request));
    }

    public function import(ImportLinesRequest $request, string $id, LineImport $import): JsonResponse
    {
        $doc = StockDocument::query()->findOrFail($id);
        Gate::authorize('update', $doc);
        $file = $request->file('file');

        if (! $file instanceof UploadedFile) {
            Messages::fail('file', 'import_unreadable');
        }

        return ApiResponse::success($import->run($doc, $file, $request->boolean('dry_run'), $request->optionalVersion()));
    }

    public function post(PostDocumentRequest $request, string $id): JsonResponse
    {
        $doc = StockDocument::query()->findOrFail($id);
        Gate::authorize('post', $doc);

        // The ledger checks the flag on the locked document against this permission.
        $posted = $this->ledger->post(
            $doc,
            new PostOptions($this->actor($request), expiredAllowed: Gate::allows('issueExpired', StockDocument::class)),
            $request->optionalVersion(),
        );

        return ApiResponse::success($this->resolve(new StockDocumentResource($posted->load('lines')), $request));
    }

    public function reverse(ReverseDocumentRequest $request, string $id): JsonResponse
    {
        $doc = StockDocument::query()->findOrFail($id);
        Gate::authorize('reverse', $doc);
        $reversed = $this->ledger->reverse(
            $doc,
            new DateTimeImmutable($request->string('date')->toString()),
            $request->string('reason')->toString(),
            $this->actor($request),
            $request->optionalVersion(),
        );

        return ApiResponse::success($this->resolve(new StockDocumentResource($reversed->load('lines')), $request));
    }

    /**
     * Lines of the filtered documents as CSV (default) or XLSX; refused above the row cap.
     */
    public function export(Request $request): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', StockDocument::class);
        $format = $this->format($request);
        [$request, $custom] = $this->customFilters($request, self::CUSTOM);
        $ids = $this->filtered(StockDocument::query(), $custom)->select('id')->toBase();
        $this->listFilters($ids, $request);
        $query = DB::table('stock_document_lines as l')
            ->join('stock_documents as d', 'd.id', '=', 'l.document_id')
            ->leftJoin('items as i', 'i.id', '=', 'l.item_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'd.warehouse_id')
            ->whereIn('d.id', $ids)
            ->orderBy('d.document_date')->orderBy('d.number')->orderBy('l.line_no');
        Export::assertWithinCap((clone $query)->count());

        $rows = $query->get([
            'd.number', 'd.doc_type', 'd.status', 'd.document_date', 'w.code as warehouse_code', 'l.line_no', 'i.code as item_code', 'i.name as item_name',
            'l.quantity', 'l.base_quantity', 'l.unit_cost', 'l.lot_no', 'l.expiry_date', 'l.system_quantity', 'l.counted_quantity',
        ])->map(static fn (stdClass $r): array => [
            $r->number, $r->doc_type, $r->status, $r->document_date, $r->warehouse_code, $r->line_no, $r->item_code, $r->item_name,
            $r->quantity, $r->base_quantity, $r->unit_cost, $r->lot_no, $r->expiry_date, $r->system_quantity, $r->counted_quantity,
        ])->all();

        return Export::download('stock-documents', $format, [
            'number', 'doc_type', 'status', 'document_date', 'warehouse_code', 'line_no', 'item_code', 'item_name',
            'quantity', 'base_quantity', 'unit_cost', 'lot_no', 'expiry_date', 'system_quantity', 'counted_quantity',
        ], array_values($rows));
    }

    /**
     * ListQuery's equality filters and q, applied to a raw query of document ids.
     */
    private function listFilters(\Illuminate\Database\Query\Builder $q, Request $request): void
    {
        $filters = $request->query('filter');
        $allowed = ['doc_type' => 'doc_type', 'type' => 'doc_type', 'status' => 'status', 'warehouse_id' => 'warehouse_id', 'target_warehouse_id' => 'target_warehouse_id', 'source_type' => 'source_type'];

        foreach (is_array($filters) ? $filters : [] as $name => $value) {
            if (! isset($allowed[$name])) {
                throw ValidationException::withMessages(["filter.{$name}" => [(string) __('validation.in', ['attribute' => "filter.{$name}"])]]);
            }

            if (is_string($value) && $value !== '') {
                $q->whereIn($allowed[$name], explode(',', $value));
            }
        }

        $like = $this->search($request);

        if ($like !== null) {
            $q->where(fn ($w) => $w->where('number', 'ilike', $like)->orWhere('reason', 'ilike', $like)->orWhere('notes', 'ilike', $like));
        }
    }

    /**
     * @param  Builder<StockDocument>  $query
     * @param  array<string, string>  $custom
     * @return Builder<StockDocument>
     */
    private function filtered(Builder $query, array $custom): Builder
    {
        if (isset($custom['date_from'])) {
            $query->whereDate('document_date', '>=', $this->date('filter.date_from', $custom['date_from']));
        }

        if (isset($custom['date_to'])) {
            $query->whereDate('document_date', '<=', $this->date('filter.date_to', $custom['date_to']));
        }

        if (isset($custom['item_id'])) {
            $item = $this->uuid('filter.item_id', $custom['item_id']);
            $query->whereIn('id', StockDocumentLine::query()->select('document_id')->where('item_id', $item));
        }

        return $query;
    }
}
