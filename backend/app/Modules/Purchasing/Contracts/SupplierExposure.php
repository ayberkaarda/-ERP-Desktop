<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Contracts;

use App\Modules\Purchasing\Data\SupplierExposureData;

/**
 * Computed (never stored) supplier exposure: open payables plus approved, not invoiced order value
 * in company currency. Informational only; nothing is blocked by it.
 */
interface SupplierExposure
{
    public function exposure(string $companyId, string $partyId): SupplierExposureData;
}
