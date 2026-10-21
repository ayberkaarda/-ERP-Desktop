<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Console;

use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Services\AccountingBootstrap;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

final class SeedChart extends Command
{
    /** @var string */
    protected $signature = 'accounting:seed-chart {company : company id} {--scheme= : 7A or 7B (default: the company setting)}';

    /** @var string */
    protected $description = 'Seed the TDHP chart, default account determination rules and the current fiscal year for a company (idempotent)';

    public function handle(AccountingBootstrap $bootstrap, CompanyDirectory $companies): int
    {
        $company = (string) $this->argument('company');
        $option = $this->option('scheme');
        $scheme = is_string($option) && $option !== '' ? ExpenseScheme::tryFrom(strtoupper($option)) : null;

        if (! Str::isUuid($company) || ! $companies->isActive($company)) {
            $this->error(__('accounting::messages.command_company_missing'));

            return self::FAILURE;
        }

        if (is_string($option) && $option !== '' && $scheme === null) {
            $this->error(__('accounting::messages.command_scheme_invalid'));

            return self::FAILURE;
        }

        $result = $bootstrap->run($company, $scheme);

        if (! $result['chart_available']) {
            $this->warn(__('accounting::messages.command_chart_missing'));
        }

        $this->table(['key', 'value'], array_map(
            static fn (string $k, mixed $v): array => [$k, is_bool($v) ? ($v ? 'yes' : 'no') : (string) ($v ?? '-')],
            array_keys($result),
            $result,
        ));

        return self::SUCCESS;
    }
}
