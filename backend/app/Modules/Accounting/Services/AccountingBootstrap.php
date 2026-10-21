<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Support\AccountingSettings;
use App\Modules\Accounting\Support\Ledger;

/**
 * Everything a company needs to start booking: the TDHP chart, the default determination rules and
 * the current fiscal year. Settings need no rows: their registered defaults apply until changed.
 * Safe to run again at any time.
 */
final class AccountingBootstrap
{
    public function __construct(
        private readonly CompanyContext $company,
        private readonly ChartSeeder $chart,
        private readonly DeterminationRules $rules,
        private readonly FiscalCalendar $calendar,
        private readonly AccountingSettings $settings,
    ) {}

    /**
     * @return array{accounts_created: int, accounts_skipped: int, accounts_invalid: int, chart_available: bool, rules_created: int, fiscal_year_created: string|null}
     */
    public function run(string $companyId, ?ExpenseScheme $scheme = null): array
    {
        return $this->company->runAs($companyId, fn (): array => Ledger::transaction(function () use ($scheme): array {
            $scheme ??= $this->settings->expenseScheme();
            $chart = $this->chart->seed($scheme);
            $rules = $this->rules->ensureDefaults($scheme);
            $year = $this->calendar->ensureCurrent();

            return [
                'accounts_created' => $chart['created'],
                'accounts_skipped' => $chart['skipped'],
                'accounts_invalid' => $chart['invalid'],
                'chart_available' => $chart['available'],
                'rules_created' => $rules,
                'fiscal_year_created' => $year?->code,
            ];
        }));
    }
}
