<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Treasury\Banking\Services\BankPaymentGuard;
use App\Modules\Treasury\Contracts\PaymentReversalGuard;

final class BankingServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PaymentReversalGuard::class, BankPaymentGuard::class);
    }

    protected function moduleKey(): string
    {
        return 'treasury-banking';
    }
}
