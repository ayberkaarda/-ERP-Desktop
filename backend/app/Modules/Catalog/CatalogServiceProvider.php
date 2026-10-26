<?php

declare(strict_types=1);

namespace App\Modules\Catalog;

use App\Core\Modules\ModuleServiceProvider;
use App\Core\Sync\Contracts\SyncResource;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Contracts\ItemUsageChecker;
use App\Modules\Catalog\Contracts\PriceListLookup;
use App\Modules\Catalog\Contracts\PriceResolver;
use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Catalog\Listeners\SeedDefaultUnits;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\ItemCategory;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use App\Modules\Catalog\Policies\DiscountRulePolicy;
use App\Modules\Catalog\Policies\ItemCategoryPolicy;
use App\Modules\Catalog\Policies\ItemPolicy;
use App\Modules\Catalog\Policies\PriceListPolicy;
use App\Modules\Catalog\Policies\UnitPolicy;
use App\Modules\Catalog\Services\CompositeItemUsageChecker;
use App\Modules\Catalog\Services\DatabaseItemLookup;
use App\Modules\Catalog\Services\DatabasePriceListLookup;
use App\Modules\Catalog\Services\DatabasePriceResolver;
use App\Modules\Catalog\Services\DatabaseUnitLookup;
use App\Modules\Catalog\Services\ItemService;
use App\Modules\Catalog\Services\PriceListItemUsage;
use App\Modules\Catalog\Sync\ItemBarcodeSyncResource;
use App\Modules\Catalog\Sync\ItemCategorySyncResource;
use App\Modules\Catalog\Sync\ItemSyncResource;
use App\Modules\Catalog\Sync\ItemVariantSyncResource;
use App\Modules\Catalog\Sync\PriceListLineSyncResource;
use App\Modules\Catalog\Sync\PriceListSyncResource;
use App\Modules\Catalog\Sync\UnitConversionSyncResource;
use App\Modules\Catalog\Sync\UnitSyncResource;
use App\Modules\Organization\Events\CompanyCreated;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;

final class CatalogServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(Contracts\AssistantTools::class, Assistant\Tools::class);
        $this->app->bind(ItemLookup::class, DatabaseItemLookup::class);
        $this->app->bind(UnitLookup::class, DatabaseUnitLookup::class);
        $this->app->bind(PriceListLookup::class, DatabasePriceListLookup::class);
        $this->app->bind(PriceResolver::class, DatabasePriceResolver::class);
        $this->app->bind(ItemUsageChecker::class, CompositeItemUsageChecker::class);
        $this->app->tag([PriceListItemUsage::class], ItemUsageChecker::TAG);

        $this->app->tag([
            UnitSyncResource::class,
            UnitConversionSyncResource::class,
            ItemCategorySyncResource::class,
            ItemSyncResource::class,
            ItemVariantSyncResource::class,
            ItemBarcodeSyncResource::class,
            PriceListSyncResource::class,
            PriceListLineSyncResource::class,
        ], SyncResource::TAG);

        // Item codes: ITM + year + 6 digits, unless the deployment configured its own format.
        if (config('numbering.formats.'.ItemService::DOC_TYPE) === null) {
            config(['numbering.formats.'.ItemService::DOC_TYPE => ItemService::FORMAT]);
        }
    }

    public function boot(): void
    {
        $this->bootModule();

        Relation::morphMap([
            'unit' => Unit::class,
            'unit_conversion' => UnitConversion::class,
            'item_category' => ItemCategory::class,
            'item' => Item::class,
            'item_variant' => ItemVariant::class,
            'item_unit' => ItemUnit::class,
            'item_barcode' => ItemBarcode::class,
            'price_list' => PriceList::class,
            'price_list_line' => PriceListLine::class,
            'discount_rule' => DiscountRule::class,
        ]);

        Gate::policy(Unit::class, UnitPolicy::class);
        Gate::policy(UnitConversion::class, UnitPolicy::class);
        Gate::policy(ItemCategory::class, ItemCategoryPolicy::class);
        Gate::policy(Item::class, ItemPolicy::class);
        Gate::policy(PriceList::class, PriceListPolicy::class);
        Gate::policy(DiscountRule::class, DiscountRulePolicy::class);

        // Default units and standard conversions for every new company.
        Event::listen(CompanyCreated::class, SeedDefaultUnits::class);
    }
}
