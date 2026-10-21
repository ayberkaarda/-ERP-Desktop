<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Data;

use App\Modules\Catalog\Enums\PriceSource;

/**
 * Prices are decimal strings with 6 decimals in the requested unit; discount_percent has 4.
 * unitPrice and netUnitPrice are null when no price line applies.
 */
final readonly class ResolvedPrice
{
    /**
     * @param  list<string>  $discountRuleIds  applied rules in precedence order
     */
    public function __construct(
        public ?string $unitPrice,
        public ?string $netUnitPrice,
        public string $currency,
        public ?string $priceListId,
        public ?string $priceListLineId,
        public ?string $priceUnitId,
        public ?bool $taxInclusive,
        public string $discountPercent,
        public array $discountRuleIds,
        public PriceSource $source,
    ) {}

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'unit_price' => $this->unitPrice,
            'net_unit_price' => $this->netUnitPrice,
            'currency' => $this->currency,
            'price_list_id' => $this->priceListId,
            'price_list_line_id' => $this->priceListLineId,
            'price_unit_id' => $this->priceUnitId,
            'tax_inclusive' => $this->taxInclusive,
            'discount_percent' => $this->discountPercent,
            'discount_rule_ids' => $this->discountRuleIds,
            'source' => $this->source->value,
        ];
    }
}
