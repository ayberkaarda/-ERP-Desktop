<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Data;

/**
 * A computed report: rows (every number a decimal string), the export columns in order and report
 * figures for the response meta (range, totals, currency breakdown).
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
    ) {}
}
