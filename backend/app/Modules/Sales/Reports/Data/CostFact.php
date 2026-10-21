<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Data;

use Brick\Math\BigDecimal;

/**
 * Cost of goods sold moved on one date by a sales document line, signed: a posted delivery line
 * adds its recorded cost, the cancellation of a posted delivery and a received return subtract it.
 */
final readonly class CostFact
{
    public function __construct(
        public string $date,
        public string $source,
        public string $partyId,
        public string $partyName,
        public string $itemId,
        public ?string $warehouseId,
        public BigDecimal $baseQuantity,
        public BigDecimal $cost,
    ) {}
}
