<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Data;

final readonly class StatementData
{
    /** @param list<StatementLineData> $lines */
    public function __construct(
        public string $reference,
        public string $accountReference,
        public string $currency,
        public string $from,
        public string $to,
        public string $opening,
        public string $closing,
        public array $lines,
    ) {}

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['bank_reference' => $this->reference, 'account_reference' => $this->accountReference,
            'currency_code' => $this->currency, 'start_date' => $this->from, 'end_date' => $this->to,
            'opening_balance' => $this->opening, 'closing_balance' => $this->closing,
            'lines' => array_map(static fn (StatementLineData $line): array => $line->toArray(), $this->lines)];
    }
}
