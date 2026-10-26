<?php

declare(strict_types=1);

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Xid8;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\PriceList;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sync;

uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->other = Actors::company();
    $this->user = Actors::user(['items.view', 'units.manage', 'item_categories.manage', 'price_lists.view'], $this->company);
    $this->pcs = Catalog::unit($this->company, 'PCS');
    $this->box = Catalog::unit($this->company, 'BOX');
    $this->conversion = Catalog::conversion($this->company, $this->box, $this->pcs, '12');
    $this->category = Catalog::category($this->company, 'CAT');
    $this->item = Catalog::item($this->company, $this->pcs, ['category_id' => $this->category->id]);
    $this->itemUnit = Catalog::itemUnit($this->company, $this->item, $this->box, '12');
    $this->variant = Catalog::variant($this->company, $this->item, 'V-1');
    $this->barcode = Catalog::in($this->company, function (): ItemBarcode {
        $barcode = new ItemBarcode(['unit_id' => $this->pcs->id, 'barcode' => '8690000000012', 'is_primary' => true]);
        $barcode->item_id = $this->item->id;
        $barcode->save();

        return $barcode;
    });
    $this->list = Catalog::priceList($this->company, ['code' => 'RETAIL']);
    $this->line = Catalog::line($this->company, $this->list, $this->item, $this->pcs, '10.5');
    $this->adapter = fn (string $name): SyncResource => collect(iterator_to_array(app()->tagged(SyncResource::TAG)))
        ->first(fn (SyncResource $r): bool => $r->name() === $name);
    $this->txid = fn (string $table, string $id): string => Sync::txidOf($table, $id)->value;
});

/**
 * Rows a pull would deliver for the company (below the horizon), as REST JSON.
 *
 * @return list<array<string, mixed>>
 */
function pulled(SyncResource $adapter, string $company): array
{
    $max = DB::table($adapter->table())->selectRaw('max(sync_txid)::text AS v')->value('v');
    $horizon = Sync::awaitHorizonPast(Xid8::of((string) $max));
    $rows = $adapter->query($company)
        ->whereRaw("{$adapter->positionColumn()} < ?::xid8", [$horizon->value])
        ->orderByRaw("{$adapter->positionColumn()}, {$adapter->table()}.id")
        ->get();
    $class = $adapter->resourceClass();

    /** @var class-string<JsonResource> $class */
    return json_decode((string) json_encode($class::collection($rows)->resolve(request())), true);
}

it('serves exactly the manifest resources, embeds and parent keys', function (): void {
    $manifest = json_decode((string) file_get_contents(base_path('../contracts/offline-manifest.json')), true);
    $expected = [];

    foreach ($manifest['resources'] as $resource) {
        if ($resource['module'] !== 'Catalog') {
            continue;
        }

        $expected[$resource['resource']] = [$resource['api_resource'], $resource['embeds'] ?? [], null, $resource['scope']];

        foreach ($resource['children'] ?? [] as $child) {
            $expected[$child['resource']] = [$child['api_resource'], [], str_ends_with($child['resource'], '.lines') ? 'price_list_id' : 'item_id', $resource['scope']];
        }
    }

    $actual = [];

    foreach (iterator_to_array(app()->tagged(SyncResource::TAG)) as $adapter) {
        if (str_starts_with($adapter::class, 'App\\Modules\\Catalog\\')) {
            $actual[$adapter->name()] = [$adapter->resourceClass(), $adapter->embeds(), $adapter->parentKey(), $adapter->scope()->value];
        }
    }

    ksort($expected);
    ksort($actual);
    expect($actual)->toBe($expected);
});

it('serves each resource in the REST shape', function (string $name, string $uri): void {
    $uri = strtr($uri, ['{item}' => $this->item->id, '{list}' => $this->list->id]);
    $expected = collect(Catalog::as($this->user, $this->company)->getJson($uri)->assertOk()->json('data'))->keyBy('id');
    $rows = collect(pulled(($this->adapter)($name), $this->company));

    expect($rows)->not->toBeEmpty();

    foreach ($rows as $row) {
        expect($expected->get($row['id']))->toBe($row);
    }
})->with([
    'units' => ['units', '/api/v1/units'],
    'unit-conversions' => ['unit-conversions', '/api/v1/unit-conversions'],
    'item-categories' => ['item-categories', '/api/v1/item-categories'],
    'items.variants' => ['items.variants', '/api/v1/items/{item}/variants'],
    'items.barcodes' => ['items.barcodes', '/api/v1/items/{item}/barcodes'],
    'price-lists' => ['price-lists', '/api/v1/price-lists'],
    'price-lists.lines' => ['price-lists.lines', '/api/v1/price-lists/{list}/lines'],
]);

it('serves items with the manifest embeds, as the REST detail shows them', function (): void {
    $rows = pulled(($this->adapter)('items'), $this->company);
    $show = Catalog::as($this->user, $this->company)->getJson("/api/v1/items/{$this->item->id}")->assertOk()->json('data');

    expect($rows)->toHaveCount(1)
        ->and($rows[0])->toBe($show)
        ->and($rows[0]['base_unit']['code'])->toBe('PCS')
        ->and($rows[0]['category']['code'])->toBe('CAT')
        ->and($rows[0]['units'][0]['unit']['code'])->toBe('BOX');
});

it('keeps other companies out of every resource', function (): void {
    $unit = Catalog::unit($this->other, 'FOREIGN');
    $item = Catalog::item($this->other, $unit);
    $variant = Catalog::variant($this->other, $item, 'F-1');

    foreach (['units', 'items', 'items.variants'] as $name) {
        $ids = array_column(pulled(($this->adapter)($name), $this->company), 'id');
        expect($ids)->not->toContain($unit->id)->not->toContain($item->id)->not->toContain($variant->id);
    }

    expect(array_column(pulled(($this->adapter)('units'), $this->other), 'id'))->toBe([$unit->id]);
});

it('records soft deletes as tombstones and hides the row', function (string $name, Closure $subject): void {
    $adapter = ($this->adapter)($name);
    $model = $subject($this);
    Catalog::in($this->company, fn () => $model->delete());
    $tombstone = Sync::tombstone($adapter->table(), $model->id);

    expect($tombstone)->not->toBeNull()
        ->and($tombstone->reason)->toBe('soft_deleted')
        ->and($tombstone->company_id)->toBe($this->company)
        ->and($tombstone->parent_id)->toBe($adapter->parentKey() === null ? null : $model->{$adapter->parentKey()});

    expect($adapter->query($this->company)->whereKey($model->id)->exists())->toBeFalse();

    Catalog::in($this->company, fn () => $model->restore());
    expect(Sync::tombstone($adapter->table(), $model->id))->toBeNull();
})->with([
    'units' => ['units', fn ($t) => Catalog::unit($t->company, 'GONE')],
    'items' => ['items', fn ($t) => $t->item],
    'items.variants' => ['items.variants', fn ($t) => $t->variant],
    'item-categories' => ['item-categories', fn ($t) => Catalog::category($t->company, 'GONE')],
    'price-lists' => ['price-lists', fn ($t) => $t->list],
]);

it('records hard deletes as tombstones', function (string $name, Closure $subject): void {
    $adapter = ($this->adapter)($name);
    $model = $subject($this);
    $parent = $adapter->parentKey() === null ? null : $model->{$adapter->parentKey()};
    DB::table($adapter->table())->where('id', $model->id)->delete();
    $tombstone = Sync::tombstone($adapter->table(), $model->id);

    expect($tombstone)->not->toBeNull()
        ->and($tombstone->reason)->toBe('deleted')
        ->and($tombstone->company_id)->toBe($this->company)
        ->and($tombstone->parent_id)->toBe($parent);
})->with([
    'unit-conversions' => ['unit-conversions', fn ($t) => $t->conversion],
    'items.barcodes' => ['items.barcodes', fn ($t) => $t->barcode],
    'price-lists.lines' => ['price-lists.lines', fn ($t) => $t->line],
]);

it('touches the parent item when a child changes, without touching its version', function (Closure $change): void {
    $before = ($this->txid)('items', $this->item->id);
    $item = Item::query()->withoutCompanyScope()->whereKey($this->item->id)->firstOrFail();

    $change($this);

    $after = Item::query()->withoutCompanyScope()->whereKey($this->item->id)->firstOrFail();
    expect(($this->txid)('items', $this->item->id))->not->toBe($before)
        ->and($after->version)->toBe($item->version)
        ->and($after->updated_at?->toIso8601String())->toBe($item->updated_at?->toIso8601String());
})->with([
    'variant insert' => [fn ($t) => Catalog::variant($t->company, $t->item, 'V-2')],
    'variant update' => [fn ($t) => DB::table('item_variants')->where('id', $t->variant->id)->update(['name' => 'Renamed'])],
    'barcode update' => [fn ($t) => DB::table('item_barcodes')->where('id', $t->barcode->id)->update(['type' => 'ean13'])],
    'barcode delete' => [fn ($t) => DB::table('item_barcodes')->where('id', $t->barcode->id)->delete()],
    'item unit update' => [fn ($t) => DB::table('item_units')->where('id', $t->itemUnit->id)->update(['factor' => '24'])],
    'item unit delete' => [fn ($t) => DB::table('item_units')->where('id', $t->itemUnit->id)->delete()],
]);

it('moves the variant position on its own change', function (): void {
    $before = ($this->txid)('item_variants', $this->variant->id);
    DB::table('item_variants')->where('id', $this->variant->id)->update(['name' => 'X']);

    expect(($this->txid)('item_variants', $this->variant->id))->not->toBe($before);
});

it('touches the price list when a line changes', function (): void {
    $before = ($this->txid)('price_lists', $this->list->id);
    $list = PriceList::query()->withoutCompanyScope()->whereKey($this->list->id)->firstOrFail();

    DB::table('price_list_lines')->where('id', $this->line->id)->update(['price' => '11']);
    $afterUpdate = ($this->txid)('price_lists', $this->list->id);
    Catalog::line($this->company, $this->list, $this->item, $this->box, '99');
    $afterInsert = ($this->txid)('price_lists', $this->list->id);
    DB::table('price_list_lines')->where('id', $this->line->id)->delete();
    $afterDelete = ($this->txid)('price_lists', $this->list->id);
    $fresh = PriceList::query()->withoutCompanyScope()->whereKey($this->list->id)->firstOrFail();

    expect(count(array_unique([$before, $afterUpdate, $afterInsert, $afterDelete])))->toBe(4)
        ->and($fresh->version)->toBe($list->version);
});

it('delivers a touched item again once the horizon passes', function (): void {
    $before = Sync::txidOf('items', $this->item->id);
    Catalog::variant($this->company, $this->item, 'V-3');
    Sync::awaitHorizonPast(Sync::txidOf('items', $this->item->id));

    expect(Sync::txidOf('items', $this->item->id)->greaterThan($before))->toBeTrue()
        ->and(Sync::belowHorizon('items'))->toContain($this->item->id);
});

it('does not leak the sync position into any resource', function (): void {
    foreach (iterator_to_array(app()->tagged(SyncResource::TAG)) as $adapter) {
        if (! str_starts_with($adapter::class, 'App\\Modules\\Catalog\\')) {
            continue;
        }

        foreach (pulled($adapter, $this->company) as $row) {
            expect(json_encode($row))->not->toContain('sync_txid');
        }
    }

    $show = Catalog::as($this->user, $this->company)->getJson("/api/v1/items/{$this->item->id}")->assertOk()->json('data');
    expect(json_encode($show))->not->toContain('sync_txid');
});
