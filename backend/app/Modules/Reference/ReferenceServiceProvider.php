<?php

declare(strict_types=1);

namespace App\Modules\Reference;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Reference\Console\BackfillRates;
use App\Modules\Reference\Console\FetchTcmbRates;
use App\Modules\Reference\Listeners\SeedCompanyDefaults;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Policies\ReferencePolicy;
use App\Modules\Reference\Rules\CurrencyCode;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Enums\SettingType;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;

final class ReferenceServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bindIf(Services\ExternalReferences::BRANCH_LOOKUP, Services\NullLookup::class);
        $this->app->bindIf(Services\ExternalReferences::PARTY_LOOKUP, Services\NullLookup::class);
        $this->app->bind(Contracts\CurrencyLookup::class, Services\DatabaseCurrencyLookup::class);
        $this->app->bind(Contracts\TaxCodeLookup::class, Services\DatabaseTaxCodeLookup::class);
        $this->app->bind(Contracts\PaymentTermLookup::class, Services\DatabasePaymentTermLookup::class);
        $this->app->bind(Contracts\WarehouseLookup::class, Services\DatabaseWarehouseLookup::class);
        $this->app->bind(Contracts\DimensionLookup::class, Services\DatabaseDimensionLookup::class);
        $this->app->bind(Contracts\ExchangeRateProvider::class, Services\DatabaseExchangeRateProvider::class);
    }

    public function boot(): void
    {
        parent::boot();
        foreach ([...array_values(Services\ReferenceSchema::MODELS), CompanyCurrency::class] as $model) {
            Gate::policy($model, ReferencePolicy::class);
            Relation::morphMap(['reference_'.(new $model)->getTable() => $model]);
        }
        $this->app->make(SettingsRegistrar::class)->register(new SettingDefinition(
            'company.base_currency', SettingType::String, 'TRY', 'company',
            rules: ['size:3', 'regex:/^[A-Z]{3}$/', new CurrencyCode],
        ));
        // Currencies, payment terms, default warehouse and root cost center for every new company.
        Event::listen(CompanyCreated::class, SeedCompanyDefaults::class);
        // Core has no schedule hook yet, so the module registers its daily TCMB import itself.
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            $schedule->command('rates:fetch-tcmb')->dailyAt('16:00')->timezone('Europe/Istanbul')
                ->withoutOverlapping()->onOneServer()
                // Rates are global: the Notifier only addresses members of an active company, so failures are logged.
                ->onFailure(fn () => Log::error('reference.rates_fetch_failed', ['command' => 'rates:fetch-tcmb']));
        });
        if ($this->app->runningInConsole()) {
            $this->commands([FetchTcmbRates::class, BackfillRates::class]);
        }
    }
}
