<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Contracts;

use App\Modules\Accounting\Data\AccountRef;
use App\Modules\Accounting\Exceptions\AccountNotDetermined;

/**
 * Event key (e.g. sales.revenue.goods) + context (party_group, item_category, currency, tax_code, ...)
 * to an account of the active company.
 */
interface AccountDeterminer
{
    /**
     * @param  array<string, string|int|null>  $context
     *
     * @throws AccountNotDetermined
     */
    public function resolve(string $eventKey, array $context = []): AccountRef;
}
