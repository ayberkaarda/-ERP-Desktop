<?php

declare(strict_types=1);

namespace App\Modules\Sales\Data;

/**
 * Outcome of a credit check: current exposure plus this document against the limit, in the risk currency.
 */
final readonly class CreditCheck
{
    public function __construct(
        public string $mode,
        public ?string $limit,
        public string $currency,
        public string $exposure,
        public string $document,
        public string $total,
        public ?string $available,
        public bool $exceeded,
        public bool $overridden = false,
    ) {}

    /** @return array<string, string|bool|null> */
    public function toArray(): array
    {
        return [
            'mode' => $this->mode, 'limit' => $this->limit, 'currency' => $this->currency, 'exposure' => $this->exposure,
            'document' => $this->document, 'total' => $this->total, 'available' => $this->available,
            'exceeded' => $this->exceeded, 'overridden' => $this->overridden,
        ];
    }
}
