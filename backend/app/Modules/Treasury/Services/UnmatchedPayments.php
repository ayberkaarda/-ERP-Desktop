<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Services;

use App\Modules\Treasury\Contracts\PaymentReversalGuard;

final class UnmatchedPayments implements PaymentReversalGuard
{
    public function assertUnmatched(string $paymentId): void {}

    public function assertMovementUnmatched(string $movementId): void {}
}
