<?php

declare(strict_types=1);

namespace App\Modules\Purchasing;

use App\Core\Modules\ModuleServiceProvider;
use App\Models\User;
use App\Modules\Purchasing\Contracts\PayableSettlement;
use App\Modules\Purchasing\Contracts\PurchaseInvoiceLookup;
use App\Modules\Purchasing\Contracts\SupplierExposure;
use App\Modules\Purchasing\Contracts\SupplierPerformance;
use App\Modules\Purchasing\Http\Controllers\PreviewController;
use App\Modules\Purchasing\Http\Controllers\SupplierController;
use App\Modules\Purchasing\Listeners\ApprovalListener;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Models\PurchaseRfq;
use App\Modules\Purchasing\Policies\InvoicePolicy;
use App\Modules\Purchasing\Policies\OrderPolicy;
use App\Modules\Purchasing\Policies\PurchasingPolicy;
use App\Modules\Purchasing\Policies\ReceiptPolicy;
use App\Modules\Purchasing\Policies\RequestPolicy;
use App\Modules\Purchasing\Policies\ReturnPolicy;
use App\Modules\Purchasing\Policies\RfqPolicy;
use App\Modules\Purchasing\Reports\ReportsServiceProvider;
use App\Modules\Purchasing\Services\ExposureCalculator;
use App\Modules\Purchasing\Services\InvoiceDirectory;
use App\Modules\Purchasing\Services\PerformanceCalculator;
use App\Modules\Purchasing\Services\Settlement;
use App\Modules\Purchasing\Support\PurchasingSettings;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Events\ApprovalRejected;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Translation\Translator;

/**
 * Purchasing: requests, RFQs, orders, goods receipts, supplier invoices and returns. Stock moves
 * only through Inventory's StockService and the ledger only through Accounting's PostingService.
 */
final class PurchasingServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(Contracts\AssistantTools::class, Assistant\Tools::class);
        $this->mergeConfigFrom(__DIR__.'/config/purchasing.php', 'purchasing');

        $this->app->bind(SupplierExposure::class, ExposureCalculator::class);
        $this->app->bind(PurchaseInvoiceLookup::class, InvoiceDirectory::class);
        $this->app->bind(PayableSettlement::class, Settlement::class);
        $this->app->bind(SupplierPerformance::class, PerformanceCalculator::class);
        $this->app->register(ReportsServiceProvider::class);
    }

    public function boot(): void
    {
        $this->bootModule();

        Relation::morphMap([
            'purchase_request' => PurchaseRequest::class,
            'purchase_rfq' => PurchaseRfq::class,
            'purchase_order' => PurchaseOrder::class,
            'purchase_receipt' => PurchaseReceipt::class,
            'purchase_invoice' => PurchaseInvoice::class,
            'purchase_return' => PurchaseReturn::class,
        ]);

        Gate::policy(PurchaseRequest::class, RequestPolicy::class);
        Gate::policy(PurchaseRfq::class, RfqPolicy::class);
        Gate::policy(PurchaseOrder::class, OrderPolicy::class);
        Gate::policy(PurchaseReceipt::class, ReceiptPolicy::class);
        Gate::policy(PurchaseInvoice::class, InvoicePolicy::class);
        Gate::policy(PurchaseReturn::class, ReturnPolicy::class);
        Gate::define('purchasing-preview', static fn (User $user, ?string $model = null): bool => self::any($user, PreviewController::PERMISSIONS));
        Gate::define('purchasing-supplier-view', static fn (User $user): bool => self::any($user, SupplierController::PERMISSIONS));

        PurchasingSettings::register($this->app->make(SettingsRegistrar::class));
        $this->registerSettingLabels();
        Event::listen(ApprovalCompleted::class, [ApprovalListener::class, 'completed']);
        Event::listen(ApprovalRejected::class, [ApprovalListener::class, 'rejected']);
    }

    /**
     * @param  list<string>  $permissions
     */
    private static function any(User $user, array $permissions): bool
    {
        foreach ($permissions as $permission) {
            if (PurchasingPolicy::permits($user, $permission)) {
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
                $labels = $translator->get('purchasing::settings', [], $locale, false);

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
