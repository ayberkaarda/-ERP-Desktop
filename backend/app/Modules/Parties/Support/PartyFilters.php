<?php

declare(strict_types=1);

namespace App\Modules\Parties\Support;

use App\Core\Http\ListQuery;
use App\Modules\Parties\Enums\PartyRole;
use App\Modules\Parties\Models\Party;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * List parameters of /parties shared by the list and the export. filter[role] matches the JSON
 * roles array (GIN index), the other filters and q go through Core ListQuery.
 */
final class PartyFilters
{
    public const array SORTS = ['code', 'name', 'legal_name', 'tax_number', 'country', 'created_at', 'updated_at'];

    public const array FILTERS = ['is_active', 'type', 'country', 'default_currency_code', 'payment_term_id', 'price_list_id'];

    public const array SEARCHABLE = ['name', 'legal_name', 'code', 'tax_number'];

    /**
     * @return LengthAwarePaginator<int, Party>
     */
    public static function paginate(Request $request): LengthAwarePaginator
    {
        [$query, $rest] = self::withRole(Party::query(), $request);

        return ListQuery::for($query, $rest, self::SORTS, self::FILTERS, self::SEARCHABLE);
    }

    /**
     * The same filtering for exports: ListQuery runs on a single page to validate and apply
     * the parameters; its where clauses are then reused without pagination.
     *
     * @return Builder<Party>
     */
    public static function query(Request $request): Builder
    {
        [$query, $rest] = self::withRole(Party::query(), $request);
        $probe = clone $query;
        ListQuery::for($probe, $rest->duplicate([...$rest->query(), 'page' => 1, 'per_page' => 1]), self::SORTS, self::FILTERS, self::SEARCHABLE);

        // Take ListQuery's where clauses and order, never its limit/offset.
        $base = $probe->getQuery();
        $base->limit = null;
        $base->offset = null;

        return $probe;
    }

    /**
     * @param  Builder<Party>  $query
     * @return array{0: Builder<Party>, 1: Request}
     */
    private static function withRole(Builder $query, Request $request): array
    {
        $params = $request->query();
        $filter = is_array($params['filter'] ?? null) ? $params['filter'] : [];

        if (! array_key_exists('role', $filter)) {
            return [$query, $request];
        }

        $roles = PartyRole::values();
        $pattern = '/\A('.implode('|', $roles).')(,('.implode('|', $roles).'))*\z/';
        $value = Validator::make(['filter' => ['role' => $filter['role']]], [
            'filter.role' => ['nullable', 'string', 'regex:'.$pattern],
        ])->validate()['filter']['role'] ?? null;

        if (is_string($value) && $value !== '') {
            $query->where(function (Builder $w) use ($value): void {
                foreach (explode(',', $value) as $role) {
                    $w->orWhereJsonContains('roles', $role);
                }
            });
        }

        unset($filter['role']);
        $params['filter'] = $filter;

        return [$query, $request->duplicate($params)];
    }
}
