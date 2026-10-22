<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Totals;

/**
 * Tax breakdown of one tax code (and rate): base and tax in document and company currency.
 */
final readonly class TaxLine
{
    public function __construct(
        public ?string $taxCodeId,
        public string $rate,
        public string $base,
        public string $tax,
        public string $baseLocal,
        public string $taxLocal,
    ) {}

    /** @return array<string, string|null> */
    public function toArray(): array
    {
        return [
            'tax_code_id' => $this->taxCodeId, 'rate' => $this->rate, 'base' => $this->base, 'tax' => $this->tax,
            'base_local' => $this->baseLocal, 'tax_local' => $this->taxLocal,
        ];
    }
}
