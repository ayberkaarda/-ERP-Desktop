<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data;

use App\Modules\Inventory\Enums\ReservationPolicy;

/**
 * A warehouse (Reference master data) with its inventory policy.
 */
final readonly class WarehouseData
{
    public function __construct(
        public string $id,
        public string $companyId,
        public string $code,
        public string $name,
        public bool $isActive,
        public bool $isDefault,
        /** Reference policy: allow|warn|block. */
        public string $negativeStockPolicy,
        public bool $allowNegativeStock,
        public ReservationPolicy $reservationPolicy,
        /** Version of the inventory settings row (1 before the first change). */
        public int $settingsVersion,
    ) {}
}
