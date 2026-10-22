<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Totals;

/**
 * Lines (in input order) and header totals in document and company currency.
 */
final readonly class TotalsResult
{
    /**
     * @param  list<LineResult>  $lines
     * @param  list<TaxLine>  $taxes
     */
    public function __construct(
        public array $lines,
        public string $subtotal,
        public string $discountTotal,
        public string $taxTotal,
        public string $total,
        public string $subtotalLocal,
        public string $discountTotalLocal,
        public string $taxTotalLocal,
        public string $totalLocal,
        public array $taxes,
        public string $withholdingTotal = '0.00',
        public string $withholdingTotalLocal = '0.00',
    ) {}

    /** @return array<string, string> */
    public function headerAttributes(): array
    {
        return [
            'subtotal' => $this->subtotal, 'discount_total' => $this->discountTotal, 'tax_total' => $this->taxTotal, 'total' => $this->total,
            'withholding_total' => $this->withholdingTotal,
            'subtotal_local' => $this->subtotalLocal, 'discount_total_local' => $this->discountTotalLocal,
            'tax_total_local' => $this->taxTotalLocal, 'total_local' => $this->totalLocal, 'withholding_total_local' => $this->withholdingTotalLocal,
        ];
    }
}
