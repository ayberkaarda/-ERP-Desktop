<?php

declare(strict_types=1);

namespace App\Modules\Sales\Contracts;

use App\Modules\Sales\Data\ExposureData;

/**
 * Computed (never stored) customer risk: open invoice balances plus confirmed, not invoiced order
 * value, converted to the party's risk currency. Treasury later adds cheques and notes.
 */
interface CustomerExposure
{
    public function exposure(string $companyId, string $partyId): ExposureData;
}
