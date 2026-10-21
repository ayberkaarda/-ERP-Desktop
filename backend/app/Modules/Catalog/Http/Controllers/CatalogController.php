<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Documents\HasVersion;
use App\Modules\Catalog\Models\CatalogModel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

abstract class CatalogController
{
    /**
     * Takes filters (and optionally q) that ListQuery cannot express out of the request.
     *
     * @param  list<string>  $names
     * @return array{0: Request, 1: array<string, string>, 2: string}
     */
    protected function customFilters(Request $request, array $names, bool $takeSearch = false): array
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

        $term = '';

        if ($takeSearch) {
            $term = is_string($query['q'] ?? null) ? trim($query['q']) : '';
            unset($query['q']);

            if (mb_strlen($term) > 200) {
                throw ValidationException::withMessages(['q' => [(string) __('validation.max.string', ['attribute' => 'q', 'max' => 200])]]);
            }
        }

        return [$request->duplicate($query), $custom, $term];
    }

    /**
     * filter[name]=uuid[,uuid...] on a uuid column; anything else is a 422 instead of a database error.
     *
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     * @param  array<string, string>  $custom
     * @return Builder<TModel>
     */
    protected function uuidFilter(Builder $query, string $column, array $custom, string $name): Builder
    {
        if (! isset($custom[$name])) {
            return $query;
        }

        $ids = array_map(fn (string $id): string => $this->uuid("filter.{$name}", $id), explode(',', $custom[$name]));

        return $query->whereIn($query->qualifyColumn($column), $ids);
    }

    protected function uuid(string $field, string $value): string
    {
        if (! Str::isUuid($value)) {
            throw ValidationException::withMessages([$field => [(string) __('validation.uuid', ['attribute' => $field])]]);
        }

        return $value;
    }

    protected function like(string $term): string
    {
        return '%'.addcslashes($term, '%_\\').'%';
    }

    /**
     * DELETE may carry the version the client saw; a stale one is a conflict.
     */
    protected function assertDeleteVersion(Request $request, CatalogModel $model): void
    {
        $version = $request->input('version', $request->query('version'));

        if ($version !== null && in_array(HasVersion::class, class_uses_recursive($model), true) && method_exists($model, 'assertVersion')) {
            if (! is_numeric($version)) {
                throw ValidationException::withMessages(['version' => [(string) __('validation.integer', ['attribute' => 'version'])]]);
            }

            $model->assertVersion((int) $version);
        }
    }

    /**
     * @return array<string, mixed>
     */
    protected function resolve(JsonResource $resource, Request $request): array
    {
        return $resource->resolve($request);
    }
}
