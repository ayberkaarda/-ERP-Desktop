<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Models\User;
use App\Modules\Purchasing\Policies\PurchasingPolicy;
use App\Modules\Purchasing\Services\DocumentLinks;
use App\Modules\Purchasing\Support\Export;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * List, detail and export shared by the purchasing document endpoints.
 *
 * List filters (filter[x]): the plain column filters of each type (comma lists allowed), plus
 * date_from, date_to (document_date, inclusive), number (contains), item_id (any line) and
 * supplier (orders, receipts, invoices, returns: party_id; RFQs: an invited supplier; requests: a
 * suggested supplier). q searches number and notes (and supplier name). Sorts per type; prefix -
 * for descending; default newest first. Unknown filters or sorts are 422.
 */
abstract class PurchasingController
{
    private const array CUSTOM = ['date_from', 'date_to', 'number', 'item_id', 'supplier', 'open'];

    /** @return class-string<Model> */
    abstract protected function model(): string;

    /** @return class-string<JsonResource> */
    abstract protected function resource(): string;

    /** @return class-string<Model> */
    abstract protected function lineModel(): string;

    /** @return list<string> */
    abstract protected function filters(): array;

    /** @return list<string> */
    abstract protected function sorts(): array;

    /** @return list<string> */
    abstract protected function searchable(): array;

    /** @return list<string> */
    abstract protected function exportHeadings(): array;

    /** @return list<string|int|null> */
    abstract protected function exportRow(Model $doc): array;

    /**
     * @param  Builder<Model>  $query
     */
    abstract protected function supplierFilter(Builder $query, string $partyId): void;

    /**
     * Extra keys of the detail response (links, warnings, ...).
     *
     * @return array<string, mixed>
     */
    protected function details(Model $doc): array
    {
        return ['links' => app(DocumentLinks::class)->for($doc, self::viewer())];
    }

    /** @return list<string> */
    protected function with(): array
    {
        return ['lines'];
    }

    /**
     * @param  Builder<Model>  $query
     * @param  array<string, string>  $custom
     */
    protected function customFilter(Builder $query, array $custom): void {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', $this->model());
        [$request, $custom] = $this->customFilters($request);
        $query = $this->filtered($this->model()::query()->withCount('lines'), $custom);

        if ($request->query('sort') === null) {
            $query->orderByDesc('document_date')->orderByDesc('created_at');
        }

        return ApiResponse::paginated(ListQuery::for($query, $request, $this->sorts(), $this->filters(), $this->searchable()), $this->resource());
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', $this->model());
        $doc = $this->find($id);
        Gate::authorize('view', $doc);
        $doc->load($this->with());
        $audit = [];

        if (method_exists($doc, 'activitiesAsSubject')) {
            $audit = $doc->activitiesAsSubject()->latest()->limit(100)->get()->map(static fn (Model $a): array => [
                'event' => $a->getAttribute('event'),
                'description' => $a->getAttribute('description'),
                'causer_id' => $a->getAttribute('causer_id'),
                'properties' => $a->getAttribute('properties'),
                'created_at' => $a->getAttribute('created_at') instanceof Carbon ? $a->getAttribute('created_at')->toIso8601String() : null,
            ])->values()->all();
        }

        $resource = $this->resource();

        return ApiResponse::success([...(new $resource($doc))->resolve($request), ...$this->details($doc), 'audit' => $audit]);
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
            if (! in_array($name, $this->filters(), true)) {
                throw ValidationException::withMessages(["filter.{$name}" => [(string) __('validation.in', ['attribute' => "filter.{$name}"])]]);
            }

            if (is_string($value) && $value !== '') {
                $query->whereIn($name, explode(',', $value));
            }
        }

        $q = $request->query('q');

        if (is_string($q) && trim($q) !== '') {
            $like = '%'.addcslashes(trim(mb_substr($q, 0, 200)), '%_\\').'%';
            $query->where(function (Builder $w) use ($like): void {
                foreach ($this->searchable() as $column) {
                    $w->orWhere($column, 'ilike', $like);
                }
            });
        }

        Export::assertWithinCap((clone $query)->count());
        $rows = [];

        foreach ($query->orderBy('document_date')->orderBy('number')->orderBy('id')->cursor() as $doc) {
            /** @var Model $doc */
            $rows[] = $this->exportRow($doc);
        }

        return Export::download(Str::kebab(class_basename($this->model())).'s', is_string($format) ? $format : 'csv', $this->exportHeadings(), $rows);
    }

    protected function find(string $id): Model
    {
        if (! Str::isUuid($id)) {
            abort(404);
        }

        return $this->model()::query()->findOrFail($id);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    protected function respond(Model $doc, array $meta = [], int $status = 200, bool $replayed = false): JsonResponse
    {
        $doc->load($this->with());

        if ($replayed) {
            $meta['replayed'] = true;
        }

        $resource = $this->resource();

        return ApiResponse::success((new $resource($doc))->resolve(request()), $meta, $status);
    }

    /**
     * @param  list<array<string, mixed>>  $warnings
     * @return array<string, mixed>
     */
    protected function warningsMeta(array $warnings): array
    {
        return $warnings === [] ? [] : ['warnings' => $warnings];
    }

    protected function permits(Request $request, string $permission): bool
    {
        $user = $request->user();

        return $user instanceof User && PurchasingPolicy::permits($user, $permission);
    }

    protected function canOverridePrice(Request $request): bool
    {
        return $this->permits($request, 'purchasing.price_override');
    }

    protected function actor(Request $request): ?Authenticatable
    {
        return $request->user();
    }

    /** The user of the current request (links are limited to what this user may view). */
    protected static function viewer(): ?User
    {
        $user = request()->user();

        return $user instanceof User ? $user : null;
    }

    public static function version(Request $request): ?int
    {
        $version = $request->query('version');

        return is_numeric($version) ? (int) $version : null;
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
            'number' => ['sometimes', 'string', 'max:64'], 'item_id' => ['sometimes', 'uuid'], 'supplier' => ['sometimes', 'uuid'],
            'open' => ['sometimes', 'in:0,1,true,false'],
        ], [], ['date_from' => 'filter.date_from', 'date_to' => 'filter.date_to', 'item_id' => 'filter.item_id', 'supplier' => 'filter.supplier'])->validate();

        /** @var array<string, string> $valid */
        return [$request->duplicate($query), $valid];
    }

    /**
     * @param  Builder<Model>  $query
     * @param  array<string, string>  $custom
     * @return Builder<Model>
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
            $lineClass = $this->lineModel();
            $query->whereIn('id', $lineClass::query()->select('document_id')->where('item_id', $custom['item_id']));
        }

        if (isset($custom['supplier'])) {
            $this->supplierFilter($query, $custom['supplier']);
        }

        $this->customFilter($query, $custom);

        return $query;
    }
}
