<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Composer;

use App\Modules\Sales\Services\Totals\TotalsResult;

/**
 * A validated, priced and totalled document ready to persist (or to preview).
 */
final readonly class Composed
{
    /**
     * @param  array<string, mixed>  $header  header columns incl. party snapshot and totals
     * @param  list<array<string, mixed>>  $lines  line columns in input order (line_no set)
     * @param  list<array<string, mixed>>  $warnings
     * @param  list<array{line: int, resolved: string|null, given: string}>  $priceOverrides
     * @param  list<array<string, mixed>|null>  $pricing  resolver output per line (null when the price was fixed)
     */
    public function __construct(
        public array $header,
        public array $lines,
        public TotalsResult $totals,
        public array $warnings,
        public array $priceOverrides,
        public array $pricing,
    ) {}
}
