<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Core\Company\CompanyContext;
use App\Core\Numbering\NumberSequenceService;
use App\Modules\Catalog\Contracts\ItemUsageChecker;
use App\Modules\Catalog\Events\ItemCreated;
use App\Modules\Catalog\Events\ItemUpdated;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Models\PriceListLine;

final class ItemService
{
    public const string DOC_TYPE = 'item';

    public const string SERIES = 'ITM';

    public const array INDEXES = ['items_company_code_unique' => 'code'];

    public function __construct(
        private readonly CompanyContext $context,
        private readonly NumberSequenceService $numbers,
        private readonly ItemUsageChecker $usage,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated attributes; code is generated when missing
     */
    public function create(array $data): Item
    {
        return CatalogRules::transaction(function () use ($data): Item {
            $item = new Item(collect($data)->only(Item::FIELDS)->all());

            if (! is_string($data['code'] ?? null) || $data['code'] === '') {
                $item->code = $this->nextCode();
            }

            $item->save();
            ItemCreated::dispatch($item->id, $item->company_id);

            return $item;
        }, self::INDEXES);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(Item $item, array $data, int $version): Item
    {
        return CatalogRules::transaction(function () use ($item, $data, $version): Item {
            $item->assertVersion($version);
            $item->fill(collect($data)->only(Item::FIELDS)->all());

            if ($item->isDirty('base_unit_id') && $this->baseUnitLocked($item)) {
                CatalogRules::fail('base_unit_id', 'base_unit_locked');
            }

            $item->save();
            $changed = array_values(array_diff(array_keys($item->getChanges()), ['updated_at', 'version']));

            if ($changed !== []) {
                ItemUpdated::dispatch($item->id, $item->company_id, $changed);
            }

            return $item;
        }, self::INDEXES);
    }

    public function delete(Item $item): void
    {
        CatalogRules::transaction(function () use ($item): void {
            $locked = Item::query()->whereKey($item->id)->lockForUpdate()->firstOrFail();

            if ($this->usage->isUsed($locked->id)) {
                CatalogRules::fail('item', 'item_in_use');
            }

            // Barcodes are unique per company and must be reusable once the item is gone.
            ItemBarcode::query()->where('item_id', $locked->id)->get()->each->delete();
            ItemVariant::query()->where('item_id', $locked->id)->get()->each->delete();
            $locked->delete();
        });
    }

    /**
     * Alternate units, barcodes and price lines are expressed relative to the base unit.
     */
    private function baseUnitLocked(Item $item): bool
    {
        return ItemUnit::query()->where('item_id', $item->id)->exists()
            || ItemBarcode::query()->where('item_id', $item->id)->exists()
            || PriceListLine::query()->where('item_id', $item->id)->exists()
            || $this->usage->isUsed($item->id);
    }

    private function nextCode(): string
    {
        $company = $this->context->id();
        $year = (int) now()->utc()->format('Y');

        // Skip numbers already taken by manually coded items.
        do {
            $code = $this->numbers->next($company, self::DOC_TYPE, self::SERIES, $year);
        } while (Item::query()->where('code', $code)->exists());

        return $code;
    }
}
