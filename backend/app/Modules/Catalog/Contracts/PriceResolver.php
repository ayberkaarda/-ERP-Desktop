<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Contracts;

use App\Core\Http\ApiException;
use App\Modules\Catalog\Data\ResolvedPrice;
use DateTimeInterface;

/**
 * Deterministic price and discount for one item line of the active company.
 *
 * Price: the price list of the party, then the default list of the currency; a list must be
 * active, in that currency and valid on $date. A line must be valid on $date, match the variant
 * (or have none) and have min_qty <= qty converted to the unit of the line. The most specific
 * line wins: variant line, highest min_qty (compared in base units), line in the requested unit,
 * latest valid_from, lowest id. Its price is converted to the requested unit.
 * Discount: active rules valid on $date whose scope matches and min_qty <= qty in base units.
 * The best one by priority (desc), scope specificity, party-specific, min_qty (desc), code, id
 * applies alone unless it is stackable; then every other applicable stackable rule compounds
 * with it. No currency conversion happens here.
 */
interface PriceResolver
{
    /**
     * @param  string  $qty  decimal string > 0, in $unitId
     *
     * @throws ApiException when the item, variant or unit is not usable
     */
    public function resolve(
        string $itemId,
        ?string $variantId,
        ?string $partyId,
        string $qty,
        string $unitId,
        DateTimeInterface $date,
        string $currency,
    ): ResolvedPrice;
}
