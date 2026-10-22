<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Reports computed in SQL: the line query is the single source of rows, groups and totals are SQL
 * aggregates over it, and only the requested window of rows is read (exports: the row count is
 * checked against the cap before any row is read).
 */
final class Sql
{
    /** Rows of a query (lines or groups). */
    public static function count(Builder $query): int
    {
        return DB::query()->fromSub($query, 'counted')->count();
    }

    /**
     * The window of an ordered query, shaped as report rows.
     *
     * @param  list<string>  $columns
     * @param  list<string>  $money
     * @param  list<string>  $quantities
     * @param  list<string>  $integers
     * @return list<array<string, string|int|null>>
     */
    public static function window(Builder $ordered, Window $window, int $total, array $columns, array $money, array $quantities = [], array $integers = []): array
    {
        $window->check($total);
        $rows = [];

        foreach ($window->apply($ordered)->get() as $row) {
            $rows[] = self::shape($row, $columns, $money, $quantities, $integers);
        }

        return $rows;
    }

    /**
     * One row with exactly the given columns: money at scale 4, quantities at scale 6, integers as
     * ints, the rest as text (nulls kept).
     *
     * @param  list<string>  $columns
     * @param  list<string>  $money
     * @param  list<string>  $quantities
     * @param  list<string>  $integers
     * @return array<string, string|int|null>
     */
    public static function shape(stdClass $row, array $columns, array $money, array $quantities = [], array $integers = []): array
    {
        $out = [];

        foreach ($columns as $column) {
            $value = $row->{$column} ?? null;
            $out[$column] = match (true) {
                $value === null => null,
                in_array($column, $money, true) => Num::money(Num::dec(self::text($value))),
                in_array($column, $quantities, true) => Num::qty(Num::dec(self::text($value))),
                in_array($column, $integers, true) => (int) self::text($value),
                default => self::text($value),
            };
        }

        return $out;
    }

    /**
     * Postgres uuid[] literal for `= ANY(?::uuid[])`.
     *
     * @param  list<string>  $ids
     */
    public static function uuids(array $ids): string
    {
        return '{'.implode(',', $ids).'}';
    }

    private static function text(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }
}
