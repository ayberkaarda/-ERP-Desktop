<?php

declare(strict_types=1);

namespace App\Core\Http;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Standard list endpoint parameters: page, per_page (<=100), sort=-col,col2, filter[x]=a,b, q.
 *
 * Allowed lists accept either column names or alias => column maps. Search uses
 * ILIKE so pg_trgm GIN indexes (gin_trgm_ops) on searchable columns apply.
 */
final class ListQuery
{
    public const int DEFAULT_PER_PAGE = 25;

    public const int MAX_PER_PAGE = 100;

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $q
     * @param  array<int|string, string>  $allowedSorts
     * @param  array<int|string, string>  $allowedFilters
     * @param  list<string>  $searchable
     * @return LengthAwarePaginator<int, TModel>
     *
     * @throws ValidationException
     */
    public static function for(Builder $q, Request $r, array $allowedSorts, array $allowedFilters, array $searchable): LengthAwarePaginator
    {
        $input = Validator::make($r->query(), [
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'sort' => ['sometimes', 'string', 'max:255'],
            'filter' => ['sometimes', 'array'],
            'filter.*' => ['nullable', 'string', 'max:255'],
            'q' => ['sometimes', 'nullable', 'string', 'max:200'],
        ])->validate();

        $sorts = self::normalize($allowedSorts);
        $filters = self::normalize($allowedFilters);

        /** @var array<string, string|null> $filterInput */
        $filterInput = $input['filter'] ?? [];

        foreach ($filterInput as $name => $value) {
            if (! isset($filters[$name])) {
                throw ValidationException::withMessages([
                    "filter.{$name}" => [__('validation.in', ['attribute' => "filter.{$name}"])],
                ]);
            }

            if ($value === null || $value === '') {
                continue;
            }

            $values = explode(',', $value);
            $column = $q->qualifyColumn($filters[$name]);

            count($values) === 1 ? $q->where($column, $values[0]) : $q->whereIn($column, $values);
        }

        $term = isset($input['q']) && is_string($input['q']) ? trim($input['q']) : '';

        if ($term !== '' && $searchable !== []) {
            $like = '%'.addcslashes($term, '%_\\').'%';

            $q->where(function (Builder $w) use ($searchable, $like): void {
                foreach ($searchable as $column) {
                    $w->orWhere($w->qualifyColumn($column), 'ilike', $like);
                }
            });
        }

        $sort = isset($input['sort']) && is_string($input['sort']) ? $input['sort'] : '';

        foreach (array_filter(explode(',', $sort)) as $part) {
            $descending = str_starts_with($part, '-');
            $name = ltrim($part, '-');

            if (! isset($sorts[$name])) {
                throw ValidationException::withMessages([
                    'sort' => [__('validation.in', ['attribute' => 'sort'])],
                ]);
            }

            $q->orderBy($q->qualifyColumn($sorts[$name]), $descending ? 'desc' : 'asc');
        }

        // Stable pages even when the requested sort has ties.
        $q->orderBy($q->qualifyColumn($q->getModel()->getKeyName()));

        $perPage = isset($input['per_page']) ? (int) $input['per_page'] : self::DEFAULT_PER_PAGE;
        $page = isset($input['page']) ? (int) $input['page'] : 1;

        return $q->paginate($perPage, ['*'], 'page', $page);
    }

    /**
     * @param  array<int|string, string>  $allowed
     * @return array<string, string>
     */
    private static function normalize(array $allowed): array
    {
        $map = [];

        foreach ($allowed as $alias => $column) {
            $map[is_int($alias) ? $column : $alias] = $column;
        }

        return $map;
    }
}
