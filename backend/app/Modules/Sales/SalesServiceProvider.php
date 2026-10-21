<?php

declare(strict_types=1);

namespace App\Modules\Sales;

use App\Core\Modules\ModuleServiceProvider;
use App\Models\User;
use App\Modules\Sales\Console\ExpireQuotes;
use App\Modules\Sales\Contracts\CustomerExposure;
use App\Modules\Sales\Contracts\ReceivableSettlement;
use App\Modules\Sales\Contracts\SalesInvoiceLookup;
use App\Modules\Sales\Http\Controllers\CustomerController;
use App\Modules\Sales\Http\Controllers\PreviewController;
use App\Modules\Sales\Listeners\OrderApprovalListener;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Models\SalesReturn;
use App\Modules\Sales\Policies\DeliveryPolicy;
use App\Modules\Sales\Policies\InvoicePolicy;
use App\Modules\Sales\Policies\OrderPolicy;
use App\Modules\Sales\Policies\QuotePolicy;
use App\Modules\Sales\Policies\ReturnPolicy;
use App\Modules\Sales\Policies\SalesPolicy;
use App\Modules\Sales\Reports\ReportsServiceProvider;
use App\Modules\Sales\Services\ExposureCalculator;
use App\Modules\Sales\Services\InvoiceDirectory;
use App\Modules\Sales\Services\Settlement;
use App\Modules\Sales\Support\SalesSettings;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Events\ApprovalRejected;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Translation\Translator;

/**
 * Sales: quotes, orders, deliveries, invoices and returns. Stock moves only through Inventory's
 * StockService and the ledger only through Accounting's PostingService.
 */
final class SalesServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/config/sales.php', 'sales');

        $this->app->bind(CustomerExposure::class, ExposureCalculator::class);
        $this->app->bind(SalesInvoiceLookup::class, InvoiceDirectory::class);
        $this->app->bind(ReceivableSettlement::class, Settlement::class);
        $this->app->register(ReportsServiceProvider::class);
    }

    public function boot(): void
    {
        $this->bootModule();

        Relation::morphMap([
            'sales_quote' => SalesQuote::class,
            'sales_order' => SalesOrder::class,
            'sales_delivery' => SalesDelivery::class,
            'sales_invoice' => SalesInvoice::class,
            'sales_return' => SalesReturn::class,
        ]);

        Gate::policy(SalesQuote::class, QuotePolicy::class);
        Gate::policy(SalesOrder::class, OrderPolicy::class);
        Gate::policy(SalesDelivery::class, DeliveryPolicy::class);
        Gate::policy(SalesInvoice::class, InvoicePolicy::class);
        Gate::policy(SalesReturn::class, ReturnPolicy::class);
        Gate::define('sales-preview', static fn (User $user, ?string $model = null): bool => self::any($user, PreviewController::PERMISSIONS));
        Gate::define('sales-customer-view', static fn (User $user): bool => self::any($user, CustomerController::PERMISSIONS));

        SalesSettings::register($this->app->make(SettingsRegistrar::class));
        $this->registerSettingLabels();

        Event::listen(ApprovalCompleted::class, [OrderApprovalListener::class, 'completed']);
        Event::listen(ApprovalRejected::class, [OrderApprovalListener::class, 'rejected']);

        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            $schedule->command('sales:expire-quotes')->dailyAt('01:00')->timezone('Europe/Istanbul')->withoutOverlapping()->onOneServer();
        });

        if ($this->app->runningInConsole()) {
            $this->commands([ExpireQuotes::class]);
        }
    }

    /**
     * @param  list<string>  $permissions
     */
    private static function any(User $user, array $permissions): bool
    {
        foreach ($permissions as $permission) {
            if (SalesPolicy::permits($user, $permission)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Settings labels are read from settings::registry.<key>; this module keeps its own labels in
     * lang/<locale>/settings.php and adds them to that group once every provider has booted (the
     * Settings module registers its namespace after this one), loading the group file first so the
     * other modules' labels stay.
     */
    private function registerSettingLabels(): void
    {
        $this->app->booted(function (): void {
            $translator = $this->app->make(Translator::class);

            foreach (['tr', 'en', 'de', 'fr'] as $locale) {
                $translator->load('settings', 'registry', $locale);
                $labels = $translator->get('sales::settings', [], $locale, false);

                if (! is_array($labels)) {
                    continue;
                }

                $lines = [];

                foreach ($labels as $key => $label) {
                    if (is_string($key) && is_string($label)) {
                        $lines['registry.'.$key] = $label;
                    }
                }

                $translator->addLines($lines, $locale, 'settings');
            }
        });
    }
}
