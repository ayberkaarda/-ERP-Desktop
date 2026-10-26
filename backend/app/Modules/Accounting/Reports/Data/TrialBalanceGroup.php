<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

/** Subtotal of one TDHP account class (1-9; null for accounts without a class). */
final readonly class TrialBalanceGroup
{
    public function __construct(
        public ?int $tdhpGroup,
        public ?string $name,
        public Amounts $amounts,
        public ?Amounts $previous,
    ) {}
}
