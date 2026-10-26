<?php

declare(strict_types=1);

namespace App\Modules\Sales\Console;

use App\Core\Company\CompanyContext;
use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Sales\Services\QuoteService;
use Illuminate\Console\Command;

/**
 * Marks draft and sent quotes past valid_until as expired, company by company.
 */
final class ExpireQuotes extends Command
{
    protected $signature = 'sales:expire-quotes {--company= : Only this company id}';

    protected $description = 'Expire sales quotes whose validity date has passed';

    public function handle(QuoteService $quotes, CompanyDirectory $companies, CompanyContext $context): int
    {
        $only = $this->option('company');
        $ids = is_string($only) && $only !== '' ? [$only] : array_column($companies->allActiveCompanies(), 'id');
        $total = 0;

        foreach ($ids as $id) {
            $total += $context->runAs($id, fn (): int => $quotes->expireDue($id));
        }

        $this->info("Expired {$total} quote(s).");

        return self::SUCCESS;
    }
}
