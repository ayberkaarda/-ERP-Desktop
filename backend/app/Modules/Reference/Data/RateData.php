<?php

declare(strict_types=1);

namespace App\Modules\Reference\Data;

final readonly class RateData
{
    public function __construct(
        public string $currencyCode,
        public string $rateDate,
        public ?string $forexBuying,
        public ?string $forexSelling,
        public ?string $banknoteBuying,
        public ?string $banknoteSelling,
    ) {}

    /** @return array<string, string|null> */
    public function attributes(): array
    {
        return [
            'currency_code' => $this->currencyCode, 'rate_date' => $this->rateDate,
            'forex_buying' => $this->forexBuying, 'forex_selling' => $this->forexSelling,
            'banknote_buying' => $this->banknoteBuying, 'banknote_selling' => $this->banknoteSelling,
            'source' => 'tcmb',
        ];
    }
}
