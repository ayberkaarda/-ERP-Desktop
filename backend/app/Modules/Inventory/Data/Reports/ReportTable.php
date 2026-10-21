<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data\Reports;

/**
 * A computed report: its rows (decimal strings for every number), the export columns in order and
 * report figures for the response meta (period, totals, basis).
 */
final readonly class ReportTable
{
    /**
     * @param  list<array<string, string|int|bool|null>>  $rows
     * @param  list<string>  $columns
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public array $rows,
        public array $columns,
        public array $meta,
    ) {}
}
