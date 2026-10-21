<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Totals;

/**
 * Arithmetic input of one line; decimal strings already validated (quantity > 0, scales within the columns).
 */
final readonly class LineInput
{
    public function __construct(
        public string $quantity,
        public string $unitPrice,
        public string $discountPercent = '0',
        public string $discountAmount = '0',
        public string $taxRate = '0',
        public bool $taxInclusive = false,
        public ?string $taxCodeId = null,
    ) {}
}
