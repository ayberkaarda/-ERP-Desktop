<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Modules\Identity\Models\Activity;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Shared filters for the audit list and its export. Activity is company scoped, so only the
 * active company's entries are ever visible.
 */
final class AuditQuery
{
    public const array FILTERS = ['event', 'log_name', 'subject_type', 'subject_id', 'causer_id'];

    public const array SORTS = ['created_at', 'event'];

    /**
     * Date range (from/to, ISO dates) applied to a fresh query.
     *
     * @return Builder<Activity>
     *
     * @throws ValidationException
     */
    public function base(Request $request): Builder
    {
        $range = Validator::make($request->query(), [
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ])->validate();

        $query = Activity::query();

        if (isset($range['from']) && is_string($range['from'])) {
            $query->where('created_at', '>=', Carbon::parse($range['from']));
        }

        if (isset($range['to']) && is_string($range['to'])) {
            $query->where('created_at', '<=', Carbon::parse($range['to']));
        }

        return $query;
    }

    /**
     * Same filter[x] semantics as ListQuery, for the unpaginated export.
     *
     * @param  Builder<Activity>  $query
     * @return Builder<Activity>
     *
     * @throws ValidationException
     */
    public function withFilters(Builder $query, Request $request): Builder
    {
        $input = Validator::make($request->query(), [
            'filter' => ['sometimes', 'array'],
            'filter.*' => ['nullable', 'string', 'max:255'],
            'q' => ['sometimes', 'nullable', 'string', 'max:200'],
        ])->validate();

        /** @var array<string, string|null> $filters */
        $filters = $input['filter'] ?? [];

        foreach ($filters as $name => $value) {
            if (! in_array($name, self::FILTERS, true)) {
                throw ValidationException::withMessages(["filter.{$name}" => [__('validation.in', ['attribute' => "filter.{$name}"])]]);
            }

            if ($value === null || $value === '') {
                continue;
            }

            $values = explode(',', $value);
            count($values) === 1 ? $query->where($name, $values[0]) : $query->whereIn($name, $values);
        }

        $term = isset($input['q']) && is_string($input['q']) ? trim($input['q']) : '';

        if ($term !== '') {
            $query->where('description', 'ilike', '%'.addcslashes($term, '%_\\').'%');
        }

        return $query->orderByDesc('created_at')->orderByDesc('id');
    }
}
