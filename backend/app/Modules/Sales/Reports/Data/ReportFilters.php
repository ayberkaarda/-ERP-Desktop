<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Data;

/**
 * Filters of the sales reports. The company is always the active one. Dates are inclusive Y-m-d;
 * range reports always have both, as-of reports read $asOf. The category filter matches the item's
 * own category (Catalog exposes no category tree contract, so sub-categories are not included).
 */
final readonly class ReportFilters
{
    public function __construct(
        public string $companyId,
        public ?string $dateFrom = null,
        public ?string $dateTo = null,
        public ?string $asOf = null,
        public ?string $partyId = null,
        public ?string $itemId = null,
        public ?string $categoryId = null,
        public ?string $warehouseId = null,
        public ?string $currencyCode = null,
    ) {}

    public function inRange(string $date): bool
    {
        return ($this->dateFrom === null || $date >= $this->dateFrom) && ($this->dateTo === null || $date <= $this->dateTo);
    }
}
