<?php

declare(strict_types=1);

namespace App\Modules\Sales\Data;

/**
 * Result of applying or unapplying a settlement: the invoice balance afterwards.
 */
final readonly class SettlementData
{
    public function __construct(
        public string $invoiceId,
        public string $reference,
        public string $amount,
        public string $paidAmount,
        public string $balanceDue,
        public string $status,
        /** True when the same reference had already been applied (or unapplied). */
        public bool $replayed = false,
    ) {}
}
