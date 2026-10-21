<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ListQuery;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

abstract class InventoryController
{
    protected function actor(Request $request): ?string
    {
        $id = $request->user()?->getAuthIdentifier();

        return is_string($id) ? $id : null;
    }

    protected function companyId(): string
    {
        return app(CompanyContext::class)->id();
    }

    /**
     * Pulls filters ListQuery cannot express out of the request.
     *
     * @param  list<string>  $names
     * @return array{0: Request, 1: array<string, string>}
     */
    protected function customFilters(Request $request, array $names): array
    {
        $query = $request->query();
        $filters = is_array($query['filter'] ?? null) ? $query['filter'] : [];
        $custom = [];

        foreach ($names as $name) {
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

        return [$request->duplicate($query), $custom];
    }

    /**
     * Validated filter[...] values of a raw list endpoint: uuids, dates (Y-m-d) or plain strings.
     *
     * @param  array<string, 'uuid'|'date'|'string'|'bool'|'int'>  $allowed
     * @return array<string, string>
     */
    protected function filters(Request $request, array $allowed): array
    {
        $raw = $request->query('filter');
        $raw = is_array($raw) ? $raw : [];
        $rules = [];

        foreach (array_keys($raw) as $name) {
            if (! is_string($name) || ! isset($allowed[$name])) {
                throw ValidationException::withMessages(["filter.{$name}" => [(string) __('validation.in', ['attribute' => "filter.{$name}"])]]);
            }
        }

        foreach ($allowed as $name => $type) {
            $rules[$name] = match ($type) {
                'uuid' => ['sometimes', 'nullable', 'uuid'],
                'date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
                'bool' => ['sometimes', 'nullable', 'in:0,1,true,false'],
                'int' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:36500'],
                default => ['sometimes', 'nullable', 'string', 'max:255'],
            };
        }

        $valid = Validator::make($raw, $rules)->validate();

        return array_filter(array_map(static fn (mixed $v): string => is_scalar($v) ? (string) $v : '', $valid), static fn (string $v): bool => $v !== '');
    }

    protected function search(Request $request): ?string
    {
        $q = $request->query('q');

        if ($q !== null && (! is_string($q) || mb_strlen($q) > 200)) {
            throw ValidationException::withMessages(['q' => [(string) __('validation.max.string', ['attribute' => 'q', 'max' => 200])]]);
        }

        $q = is_string($q) ? trim($q) : '';

        return $q === '' ? null : '%'.addcslashes($q, '%_\\').'%';
    }

    protected function format(Request $request): string
    {
        $valid = Validator::make($request->query(), ['format' => ['sometimes', 'in:csv,xlsx']])->validate();

        return is_string($valid['format'] ?? null) ? $valid['format'] : 'csv';
    }

    /**
     * Page/per_page pagination of a raw query, in the standard envelope meta.
     *
     * @param  class-string<JsonResource>  $resource
     * @return array{data: list<mixed>, meta: array<string, mixed>}
     */
    protected function page(Builder $query, Request $request, string $resource): array
    {
        $input = Validator::make($request->query(), [
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.ListQuery::MAX_PER_PAGE],
        ])->validate();
        $perPage = isset($input['per_page']) ? (int) $input['per_page'] : ListQuery::DEFAULT_PER_PAGE;
        $page = isset($input['page']) ? (int) $input['page'] : 1;
        $total = DB::query()->fromSub(clone $query, 'counted')->count();
        $rows = (clone $query)->forPage($page, $perPage)->get()->all();

        return [
            'data' => array_values($resource::collection($rows)->resolve($request)),
            'meta' => ['pagination' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => max(1, (int) ceil($total / $perPage)),
            ]],
        ];
    }

    /**
     * Sort keys of a raw list: "-on_hand,item_code" against an allow-list of alias => column.
     *
     * @param  array<string, string>  $allowed
     * @param  list<string>  $default
     */
    protected function sort(Builder $query, Request $request, array $allowed, array $default): void
    {
        $sort = $request->query('sort');
        $parts = is_string($sort) && $sort !== '' ? explode(',', $sort) : $default;

        foreach ($parts as $part) {
            $name = ltrim($part, '-');

            if (! isset($allowed[$name])) {
                throw ValidationException::withMessages(['sort' => [(string) __('validation.in', ['attribute' => 'sort'])]]);
            }

            $query->orderBy($allowed[$name], str_starts_with($part, '-') ? 'desc' : 'asc');
        }
    }

    protected function uuid(string $field, string $value): string
    {
        if (! Str::isUuid($value)) {
            throw ValidationException::withMessages([$field => [(string) __('validation.uuid', ['attribute' => $field])]]);
        }

        return $value;
    }

    protected function date(string $field, string $value): string
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1 || strtotime($value) === false) {
            throw ValidationException::withMessages([$field => [(string) __('validation.date_format', ['attribute' => $field, 'format' => 'Y-m-d'])]]);
        }

        return $value;
    }

    /** DELETE may carry the version the client saw. */
    protected function deleteVersion(Request $request): ?int
    {
        $version = $request->input('version', $request->query('version'));

        if ($version === null) {
            return null;
        }

        if ((! is_string($version) && ! is_int($version)) || ! ctype_digit((string) $version)) {
            throw ValidationException::withMessages(['version' => [(string) __('validation.integer', ['attribute' => 'version'])]]);
        }

        return (int) $version;
    }

    /**
     * @return array<string, mixed>
     */
    protected function resolve(JsonResource $resource, Request $request): array
    {
        return $resource->resolve($request);
    }
}
