<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Models\User;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Sales\Http\Resources\DocumentResource;
use App\Modules\Sales\Models\SalesDocument;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Policies\SalesPolicy;
use App\Modules\Sales\Services\CreditControl;
use App\Modules\Sales\Services\DocumentLinks;
use App\Modules\Sales\Services\PrintModel;
use App\Modules\Sales\Support\Export;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * List, detail, export and print model shared by the five document endpoints.
 *
 * List filters (filter[x]): status, party_id, currency_code, warehouse_id, source_type (comma lists
 * allowed), date_from, date_to (document_date, inclusive), number (contains), item_id (any line);
 * invoices also invoice_type and open (1 = issued/partially paid with a balance). q searches number,
 * party name and notes. Sorts: document_date, number, party_name, total, total_local, status,
 * due_date, created_at (prefix - for descending; default newest first).
 */
abstract class SalesDocumentController
{
    private const array CUSTOM = ['date_from', 'date_to', 'number', 'item_id', 'open'];

    /** @return class-string<SalesDocument> */
    abstract protected function model(): string;

    /** @return list<string> */
    protected function extraFilters(): array
    {
        return [];
    }

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', $this->model());
        [$request, $custom] = $this->customFilters($request);
        $query = $this->filtered($this->model()::query()->withCount('lines'), $custom);

        if ($request->query('sort') === null) {
            $query->orderByDesc('document_date')->orderByDesc('created_at');
        }

        return ApiResponse::paginated(ListQuery::for(
            $query,
            $request,
            ['document_date', 'number', 'party_name', 'total', 'total_local', 'status', 'due_date', 'created_at'],
            ['status', 'party_id', 'currency_code', 'warehouse_id', 'source_type', ...$this->extraFilters()],
            ['number', 'party_name', 'notes'],
        ), DocumentResource::class);
    }

    public function show(Request $request, string $id, DocumentLinks $links, CreditControl $credit, PartyLookup $parties): JsonResponse
    {
        Gate::authorize('viewAny', $this->model());
        $doc = $this->find($id);
        Gate::authorize('view', $doc);
        $doc->load('lines');

        $audit = $doc->activitiesAsSubject()->latest()->limit(100)->get()->map(static fn (Model $a): array => [
            'event' => $a->getAttribute('event'),
            'description' => $a->getAttribute('description'),
            'causer_id' => $a->getAttribute('causer_id'),
            'properties' => $a->getAttribute('properties'),
            'created_at' => $a->getAttribute('created_at') instanceof Carbon ? $a->getAttribute('created_at')->toIso8601String() : null,
        ])->values()->all();

        return ApiResponse::success([
            ...(new DocumentResource($doc))->resolve($request),
            'links' => $links->for($doc),
            'warnings' => $this->warnings($doc, $credit, $parties),
            'audit' => $audit,
        ]);
    }

    public function printModel(Request $request, string $id, PrintModel $print): JsonResponse
    {
        Gate::authorize('viewAny', $this->model());
        $doc = $this->find($id);
        Gate::authorize('view', $doc);

        return ApiResponse::success($print->build($doc, $request));
    }

    /**
     * Documents of the filtered list as CSV (default) or XLSX, one row each; refused above the cap.
     */
    public function export(Request $request): StreamedResponse|BinaryFileResponse
    {
        Gate::authorize('export', $this->model());
        $format = Validator::make($request->query(), ['format' => ['sometimes', 'in:csv,xlsx']])->validate()['format'] ?? 'csv';
        [$request, $custom] = $this->customFilters($request);
        $query = $this->filtered($this->model()::query(), $custom);
        $filters = $request->query('filter');

        foreach (is_array($filters) ? $filters : [] as $name => $value) {
            if (! in_array($name, ['status', 'party_id', 'currency_code', 'warehouse_id', 'source_type', ...$this->extraFilters()], true)) {
                throw ValidationException::withMessages(["filter.{$name}" => [(string) __('validation.in', ['attribute' => "filter.{$name}"])]]);
            }

            if (is_string($value) && $value !== '') {
                $query->whereIn($name, explode(',', $value));
            }
        }

        $q = $request->query('q');

        if (is_string($q) && trim($q) !== '') {
            $like = '%'.addcslashes(trim(mb_substr($q, 0, 200)), '%_\\').'%';
            $query->where(fn (Builder $w) => $w->where('number', 'ilike', $like)->orWhere('party_name', 'ilike', $like)->orWhere('notes', 'ilike', $like));
        }

        Export::assertWithinCap((clone $query)->count());
        $headings = ['number', 'status', 'document_date', 'due_date', 'party_name', 'party_tax_number', 'currency_code', 'fx_rate',
            'subtotal', 'discount_total', 'tax_total', 'total', 'total_local'];
        $invoices = $this->model() === SalesInvoice::class;

        if ($invoices) {
            array_push($headings, 'invoice_type', 'paid_amount', 'balance_due');
        }

        $rows = [];

        foreach ($query->orderBy('document_date')->orderBy('number')->orderBy('id')->cursor() as $doc) {
            /** @var SalesDocument $doc */
            $row = [
                $doc->number, $doc->currentStatus(), $doc->document_date->format('Y-m-d'), $doc->due_date?->format('Y-m-d'), $doc->party_name,
                $doc->party_tax_number, $doc->currency_code, (string) $doc->fx_rate, (string) $doc->subtotal, (string) $doc->discount_total,
                (string) $doc->tax_total, (string) $doc->total, (string) $doc->total_local,
            ];

            if ($doc instanceof SalesInvoice) {
                array_push($row, $doc->invoice_type->value, (string) $doc->paid_amount, (string) $doc->balance_due);
            }

            $rows[] = $row;
        }

        return Export::download(Str::kebab(class_basename($this->model())).'s', is_string($format) ? $format : 'csv', $headings, $rows);
    }

    protected function find(string $id): SalesDocument
    {
        if (! Str::isUuid($id)) {
            abort(404);
        }

        /** @var SalesDocument */
        return $this->model()::query()->findOrFail($id);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    protected function respond(SalesDocument $doc, array $meta = [], int $status = 200, bool $replayed = false): JsonResponse
    {
        $doc->load('lines');

        if ($replayed) {
            $meta['replayed'] = true;
        }

        return ApiResponse::success((new DocumentResource($doc))->resolve(request()), $meta, $status);
    }

    /**
     * @param  list<array<string, mixed>>  $warnings
     * @return array<string, mixed>
     */
    protected function warningsMeta(array $warnings): array
    {
        return $warnings === [] ? [] : ['warnings' => $warnings];
    }

    protected function canOverridePrice(Request $request): bool
    {
        $user = $request->user();

        return $user instanceof User && SalesPolicy::permits($user, 'sales.price_override');
    }

    protected function canOverrideCredit(Request $request): bool
    {
        $user = $request->user();

        return $user instanceof User && SalesPolicy::permits($user, 'sales.credit_override');
    }

    protected function actor(Request $request): ?Authenticatable
    {
        return $request->user();
    }

    /**
     * Credit preview for drafts that will be checked (orders, sales invoices); never blocks.
     *
     * @return list<array<string, mixed>>
     */
    private function warnings(SalesDocument $doc, CreditControl $credit, PartyLookup $parties): array
    {
        $checked = ($doc instanceof SalesOrder || ($doc instanceof SalesInvoice && ! $doc->isCreditNote())) && $doc->currentStatus() === 'draft';
        $party = $checked ? $parties->find($doc->party_id) : null;

        if ($party === null) {
            return [];
        }

        $check = $credit->check($doc->company_id, $party, (string) $doc->total_local, $doc instanceof SalesOrder ? $doc->id : null, preview: true);
        $warning = CreditControl::warning($check);

        return $warning === null ? [] : [$warning];
    }

    /**
     * @return array{0: Request, 1: array<string, string>}
     */
    private function customFilters(Request $request): array
    {
        $query = $request->query();
        $filters = is_array($query['filter'] ?? null) ? $query['filter'] : [];
        $custom = [];

        foreach (self::CUSTOM as $name) {
            if (array_key_exists($name, $filters)) {
                $value = $filters[$name];
                unset($filters[$name]);

                if (is_string($value) && $value !== '') {
                    $custom[$name] = $value;
                }
            }
        }

        $query['filter'] = $filters;

        if ($filters === []) {
            unset($query['filter']);
        }

        $valid = Validator::make($custom, [
            'date_from' => ['sometimes', 'date_format:Y-m-d'], 'date_to' => ['sometimes', 'date_format:Y-m-d'],
            'number' => ['sometimes', 'string', 'max:64'], 'item_id' => ['sometimes', 'uuid'], 'open' => ['sometimes', 'in:0,1,true,false'],
        ], [], ['date_from' => 'filter.date_from', 'date_to' => 'filter.date_to', 'item_id' => 'filter.item_id'])->validate();

        /** @var array<string, string> $valid */
        return [$request->duplicate($query), $valid];
    }

    /**
     * @param  Builder<SalesDocument>  $query
     * @param  array<string, string>  $custom
     * @return Builder<SalesDocument>
     */
    private function filtered(Builder $query, array $custom): Builder
    {
        if (isset($custom['date_from'])) {
            $query->whereDate('document_date', '>=', $custom['date_from']);
        }

        if (isset($custom['date_to'])) {
            $query->whereDate('document_date', '<=', $custom['date_to']);
        }

        if (isset($custom['number'])) {
            $query->where('number', 'ilike', '%'.addcslashes($custom['number'], '%_\\').'%');
        }

        if (isset($custom['item_id'])) {
            $lineClass = $this->model()::lineClass();
            $query->whereIn('id', $lineClass::query()->select('document_id')->where('item_id', $custom['item_id']));
        }

        if (isset($custom['open']) && in_array($custom['open'], ['1', 'true'], true) && $this->model() === SalesInvoice::class) {
            $query->whereIn('status', ['issued', 'partially_paid'])->where('balance_due', '>', 0);
        }

        return $query;
    }
}
