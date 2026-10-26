<?php

declare(strict_types=1);

namespace App\Modules\Inventory;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Catalog\Contracts\ItemUsageChecker;
use App\Modules\Inventory\Console\CheckReorder;
use App\Modules\Inventory\Console\ExpireReservations;
use App\Modules\Inventory\Console\RebuildBalances;
use App\Modules\Inventory\Console\SeedRules;
use App\Modules\Inventory\Contracts\Reservations;
use App\Modules\Inventory\Contracts\StockAvailability;
use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Contracts\WarehouseLookup;
use App\Modules\Inventory\Listeners\SeedInventoryRules;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\StockLot;
use App\Modules\Inventory\Models\StockMovement;
use App\Modules\Inventory\Models\StockReservation;
use App\Modules\Inventory\Models\WarehouseSetting;
use App\Modules\Inventory\Policies\InventoryReportPolicy;
use App\Modules\Inventory\Policies\StockDocumentPolicy;
use App\Modules\Inventory\Policies\StockMovementPolicy;
use App\Modules\Inventory\Policies\StockReservationPolicy;
use App\Modules\Inventory\Policies\WarehouseSettingPolicy;
use App\Modules\Inventory\Services\InventoryItemUsage;
use App\Modules\Inventory\Services\ReservationBook;
use App\Modules\Inventory\Services\StockPoster;
use App\Modules\Inventory\Services\StockQuery;
use App\Modules\Inventory\Services\WarehouseDirectory;
use App\Modules\Inventory\Support\InventorySettings;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;

/**
 * Stock ledger: warehouses are Reference master data (read through WarehouseDirectory), stock moves
 * only through StockLedger (documents of this module, or other modules via StockService).
 */
final class InventoryServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(Contracts\AssistantTools::class, Assistant\Tools::class);
        $this->mergeConfigFrom(__DIR__.'/config/inventory.php', 'inventory');

        $this->app->bind(StockService::class, StockPoster::class);
        $this->app->bind(StockAvailability::class, StockQuery::class);
        $this->app->bind(Reservations::class, ReservationBook::class);
        $this->app->bind(WarehouseLookup::class, WarehouseDirectory::class);
        $this->app->tag([InventoryItemUsage::class], ItemUsageChecker::TAG);
    }

    public function boot(): void
    {
        $this->bootModule();

        Relation::morphMap([
            StockDocument::MORPH => StockDocument::class,
            'stock_lot' => StockLot::class,
            'stock_reservation' => StockReservation::class,
            'stock_warehouse_setting' => WarehouseSetting::class,
        ]);

        Gate::policy(StockDocument::class, StockDocumentPolicy::class);
        Gate::policy(StockMovement::class, StockMovementPolicy::class);
        Gate::policy(StockReservation::class, StockReservationPolicy::class);
        Gate::policy(WarehouseSetting::class, WarehouseSettingPolicy::class);
        Gate::define(InventoryReportPolicy::ABILITY, [InventoryReportPolicy::class, 'view']);

        InventorySettings::register($this->app->make(SettingsRegistrar::class));
        Event::listen(CompanyCreated::class, SeedInventoryRules::class);

        // Core has no schedule hook yet, so the module registers its jobs itself.
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            $schedule->command('inventory:expire-reservations')->everyMinute()->withoutOverlapping()->onOneServer();
            $schedule->command('inventory:check-reorder')->dailyAt('07:00')->timezone('Europe/Istanbul')->withoutOverlapping()->onOneServer();
        });

        if ($this->app->runningInConsole()) {
            $this->commands([RebuildBalances::class, SeedRules::class, ExpireReservations::class, CheckReorder::class]);
        }
    }
}
