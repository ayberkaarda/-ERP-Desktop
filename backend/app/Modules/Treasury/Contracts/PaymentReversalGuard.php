<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Contracts;

interface PaymentReversalGuard
{
    public function assertUnmatched(string $paymentId): void;

    public function assertMovementUnmatched(string $movementId): void;
}
