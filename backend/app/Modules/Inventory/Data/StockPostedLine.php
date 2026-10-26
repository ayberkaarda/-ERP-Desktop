<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

/**
 * What one line of a posted stock document moved: base quantity, cost (scale 4) and the lots and
 * serial numbers its movements used (sorted).
 */
final readonly class StockPostedLine
{
    /**
     * @param  list<string>  $lotNos
     * @param  list<string>  $serials
     */
    public function __construct(
        public int $lineNo,
        public string $quantity,
        public string $totalCost,
        public array $lotNos = [],
        public array $serials = [],
    ) {}
}
