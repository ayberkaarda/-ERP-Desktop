<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Data\Reports;

/**
 * Filters shared by the stock reports: the company (always), optionally one warehouse, one item
 * category (with its sub-categories), one item and a search text on item code/name.
 */
final readonly class ReportFilters
{
    public function __construct(
        public string $companyId,
        public ?string $warehouseId = null,
        public ?string $categoryId = null,
        public ?string $itemId = null,
        public ?string $q = null,
    ) {}

    public function needsItems(): bool
    {
        return $this->categoryId !== null || $this->q !== null;
    }
}
