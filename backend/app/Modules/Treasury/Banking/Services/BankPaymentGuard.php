<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Services;

use App\Modules\Treasury\Banking\Support\Extension;
use App\Modules\Treasury\Contracts\PaymentReversalGuard;
use Illuminate\Support\Facades\DB;

final class BankPaymentGuard implements PaymentReversalGuard
{
    public function assertUnmatched(string $paymentId): void
    {
        if (DB::table('treasury_bank_statement_lines')->where('company_id', Extension::company())->where('payment_id', $paymentId)->exists()) {
            Extension::fail('payment_id', 'payment_matched');
        }
    }

    public function assertMovementUnmatched(string $movementId): void
    {
        if (DB::table('treasury_bank_statement_lines')->where('company_id', Extension::company())->where('movement_id', $movementId)->exists()) {
            Extension::fail('movement_id', 'payment_matched');
        }
    }
}
