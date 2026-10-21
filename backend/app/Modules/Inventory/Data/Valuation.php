<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

final readonly class Valuation
{
    public function __construct(
        /** Base-unit quantity, scale 6. */
        public string $onHand,
        /** Value / on hand at the cost scale (the moving average for one warehouse). */
        public string $avgCost,
        /** Book value, scale 4. */
        public string $value,
    ) {}
}
