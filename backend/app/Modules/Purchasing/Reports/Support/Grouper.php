<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Support;

use Brick\Math\BigDecimal;

/**
 * Rolls line rows up into groups: descriptive columns come from the first line of a group, money
 * (scale 4) and quantity (scale 6) columns are summed from zero (null when every line has null),
 * distinct ids and lines are counted.
 * Rows come out with exactly the given columns, in that order.
 */
final class Grouper
{
    /**
     * @param  list<array<string, string|int|null>>  $lines
     * @param  list<string>  $columns  output columns in order
     * @param  list<string>  $key  line columns forming the group key
     * @param  list<string>  $money  columns summed as money
     * @param  list<string>  $quantities  columns summed as quantities
     * @param  array<string, string>  $distinct  output column => line column whose distinct values are counted
     * @return list<array<string, string|int|null>>
     */
    public static function group(array $lines, array $columns, array $key, array $money, array $quantities = [], array $distinct = [], ?string $lineCount = 'line_count'): array
    {
        $groups = [];
        $sums = [];
        $sets = [];
        $counts = [];

        foreach ($lines as $line) {
            $id = implode('|', array_map(static fn (string $c): string => (string) ($line[$c] ?? ''), $key));
            $groups[$id] ??= $line;
            $counts[$id] = ($counts[$id] ?? 0) + 1;

            foreach ([...$money, ...$quantities] as $column) {
                if (($line[$column] ?? null) !== null) {
                    $sums[$id][$column] = ($sums[$id][$column] ?? BigDecimal::zero())->plus(Num::dec($line[$column]));
                }
            }

            foreach ($distinct as $out => $column) {
                $sets[$id][$out][(string) ($line[$column] ?? '')] = true;
            }
        }

        $rows = [];

        foreach ($groups as $id => $first) {
            $row = [];

            foreach ($columns as $column) {
                $row[$column] = match (true) {
                    in_array($column, $money, true) => isset($sums[$id][$column]) ? Num::money($sums[$id][$column]) : null,
                    in_array($column, $quantities, true) => isset($sums[$id][$column]) ? Num::qty($sums[$id][$column]) : null,
                    isset($distinct[$column]) => count($sets[$id][$column] ?? []),
                    $column === $lineCount => $counts[$id],
                    default => $first[$column] ?? null,
                };
            }

            $rows[] = $row;
        }

        return $rows;
    }
}
