<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Listeners;

use App\Modules\Accounting\Services\AccountingBootstrap;
use App\Modules\Organization\Events\CompanyCreated;

/**
 * Runs inside the company creation transaction, so a company never exists without its ledger setup.
 */
final class BootstrapCompanyLedger
{
    public function __construct(private readonly AccountingBootstrap $bootstrap) {}

    public function handle(CompanyCreated $event): void
    {
        if (config('accounting.bootstrap_on_company_created') !== false) {
            $this->bootstrap->run($event->companyId);
        }
    }
}
