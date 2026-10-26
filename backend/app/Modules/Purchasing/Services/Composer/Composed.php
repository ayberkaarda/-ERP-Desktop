<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Composer;

use App\Modules\Purchasing\Services\Totals\TotalsResult;

/**
 * A validated, priced and totalled document ready to persist (or to preview).
 */
final readonly class Composed
{
    /**
     * @param  array<string, mixed>  $header  header columns incl. supplier snapshot and totals
     * @param  list<array<string, mixed>>  $lines  line columns in input order (line_no set)
     * @param  list<array<string, mixed>>  $warnings
     * @param  list<array{line: int, source: string, given: string}>  $priceOverrides
     */
    public function __construct(
        public array $header,
        public array $lines,
        public TotalsResult $totals,
        public array $warnings,
        public array $priceOverrides,
    ) {}
}
