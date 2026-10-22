<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Data;

/**
 * A computed report: rows (every number a decimal string), the export columns in order and report
 * figures for the response meta (range, totals, currency breakdown). $total is the row count of the
 * whole report when the rows are already the requested window (paged in SQL), null when the rows
 * are the whole report.
 */
final readonly class ReportTable
{
    /**
     * @param  list<array<string, string|int|null>>  $rows
     * @param  list<string>  $columns
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public array $rows,
        public array $columns,
        public array $meta,
        public ?int $total = null,
    ) {}
}
