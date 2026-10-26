<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Contracts;

/**
 * For modules that store a price_list_id (e.g. the default list of a party).
 */
interface PriceListLookup
{
    /** The list exists in the active company and is not deleted. */
    public function exists(string $priceListId): bool;

    public function currency(string $priceListId): ?string;
}
