<?php

declare(strict_types=1);

namespace App\Modules\Accounting;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Accounting\Console\RebuildBalances;
use App\Modules\Accounting\Console\SeedChart;
use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Contracts\AccountLookup;
use App\Modules\Accounting\Contracts\PeriodGuard;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Listeners\BootstrapCompanyLedger;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Policies\AccountingPeriodPolicy;
use App\Modules\Accounting\Policies\AccountPolicy;
use App\Modules\Accounting\Policies\DeterminationRulePolicy;
use App\Modules\Accounting\Policies\FiscalYearPolicy;
use App\Modules\Accounting\Policies\JournalEntryPolicy;
use App\Modules\Accounting\Services\AccountDirectory;
use App\Modules\Accounting\Services\LedgerPoster;
use App\Modules\Accounting\Services\Periods;
use App\Modules\Accounting\Services\RuleDeterminer;
use App\Modules\Accounting\Support\AccountingSettings;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;

/**
 * Reports/ (report endpoints) plugs in by convention: routes.php requires Reports/routes.php,
 * Reports/ReportsServiceProvider is registered and Reports/Database/migrations loaded when present.
 */
final class AccountingServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/config/accounting.php', 'accounting');

        $this->app->bind(PostingService::class, LedgerPoster::class);
        $this->app->bind(AccountDeterminer::class, RuleDeterminer::class);
        $this->app->bind(PeriodGuard::class, Periods::class);
        $this->app->bind(AccountLookup::class, AccountDirectory::class);

        // Reports/ is a sub-package by convention: its own provider (bindings) when present.
        $reports = __NAMESPACE__.'\\Reports\\ReportsServiceProvider';

        if (class_exists($reports)) {
            $this->app->register($reports);
        }
    }

    public function boot(): void
    {
        $this->bootModule();

        if (is_dir(__DIR__.'/Reports/Database/migrations')) {
            $this->loadMigrationsFrom(__DIR__.'/Reports/Database/migrations');
        }

        Relation::morphMap([
            'fiscal_year' => FiscalYear::class,
            'accounting_period' => AccountingPeriod::class,
            'account' => Account::class,
            'journal_entry' => JournalEntry::class,
            'account_determination_rule' => AccountDeterminationRule::class,
        ]);

        Gate::policy(FiscalYear::class, FiscalYearPolicy::class);
        Gate::policy(AccountingPeriod::class, AccountingPeriodPolicy::class);
        Gate::policy(Account::class, AccountPolicy::class);
        Gate::policy(JournalEntry::class, JournalEntryPolicy::class);
        Gate::policy(AccountDeterminationRule::class, DeterminationRulePolicy::class);

        AccountingSettings::register($this->app->make(SettingsRegistrar::class));
        Event::listen(CompanyCreated::class, BootstrapCompanyLedger::class);

        if ($this->app->runningInConsole()) {
            $this->commands([SeedChart::class, RebuildBalances::class]);
        }
    }
}
