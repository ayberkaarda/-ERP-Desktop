<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Totals;

/**
 * Computed amounts of one line in the document currency, scale 2 (net terms).
 */
final readonly class LineResult
{
    public function __construct(
        public string $gross,
        public string $lineDiscount,
        public string $net,
        public string $tax,
        public string $lineTotal,
    ) {}
}
