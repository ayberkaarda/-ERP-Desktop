<?php

declare(strict_types=1);

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Xid8;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\PriceList;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
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
 * One row of every catalog resource in the company, keyed by resource name.
 *
 * @return array<string, list<string>>
 */
function catalogSet(string $company): array
{
    $pcs = Catalog::unit($company, 'PCS');
    $box = Catalog::unit($company, 'BOX');
    $conversion = Catalog::conversion($company, $box, $pcs, '12');
    $category = Catalog::category($company, 'CAT');
    $item = Catalog::item($company, $pcs, ['category_id' => $category->id]);
    Catalog::itemUnit($company, $item, $box, '12');
    $variant = Catalog::variant($company, $item, 'V-1');
    $barcode = Catalog::in($company, function () use ($item, $pcs): ItemBarcode {
        $barcode = new ItemBarcode(['unit_id' => $pcs->id, 'barcode' => '8690000000012', 'is_primary' => true]);
        $barcode->item_id = $item->id;
        $barcode->save();

        return $barcode;
    });
    $list = Catalog::priceList($company, ['code' => 'RETAIL']);
    $line = Catalog::line($company, $list, $item, $pcs, '10.5');

    return [
        'units' => [$pcs->id, $box->id],
        'unit-conversions' => [$conversion->id],
        'item-categories' => [$category->id],
        'items' => [$item->id],
        'items.variants' => [$variant->id],
        'items.barcodes' => [$barcode->id],
        'price-lists' => [$list->id],
        'price-lists.lines' => [$line->id],
    ];
}

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

it('keeps each company to its own rows in every resource, whatever company is active', function (): void {
    $mine = [
        'units' => [$this->pcs->id, $this->box->id],
        'unit-conversions' => [$this->conversion->id],
        'item-categories' => [$this->category->id],
        'items' => [$this->item->id],
        'items.variants' => [$this->variant->id],
        'items.barcodes' => [$this->barcode->id],
        'price-lists' => [$this->list->id],
        'price-lists.lines' => [$this->line->id],
    ];
    $theirs = catalogSet($this->other);

    foreach ($mine as $name => $ids) {
        $adapter = ($this->adapter)($name);
        $none = pulled($adapter, $this->company);
        $asOther = Catalog::in($this->other, fn (): array => pulled($adapter, $this->company));
        $asMine = Catalog::in($this->company, fn (): array => pulled($adapter, $this->company));

        expect(array_column($none, 'id'))->toEqualCanonicalizing($ids, $name)
            ->and($asOther)->toBe($none)
            ->and($asMine)->toBe($none)
            ->and(array_column(pulled($adapter, $this->other), 'id'))->toEqualCanonicalizing($theirs[$name], $name)
            ->and(Catalog::in($this->company, fn (): array => array_column(pulled($adapter, $this->other), 'id')))
            ->toEqualCanonicalizing($theirs[$name], $name);
    }
});

it('does not embed another company\'s rows through a cross-company reference', function (): void {
    $theirs = Catalog::unit($this->other, 'THEIRS');
    $theirCategory = Catalog::category($this->other, 'THEIRS');
    $now = now();
    DB::table('items')->where('id', $this->item->id)->update(['base_unit_id' => $theirs->id, 'category_id' => $theirCategory->id]);
    DB::table('item_units')->where('id', $this->itemUnit->id)->update(['unit_id' => $theirs->id]);
    DB::table('item_units')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $this->other, 'item_id' => $this->item->id, 'unit_id' => Catalog::unit($this->other, 'THEIRS2')->id,
        'factor' => '6', 'version' => 1, 'created_at' => $now, 'updated_at' => $now,
    ]);
    DB::table('unit_conversions')->where('id', $this->conversion->id)->update(['to_unit_id' => $theirs->id]);

    foreach ([null, $this->company, $this->other] as $active) {
        $pull = fn (string $name): array => pulled(($this->adapter)($name), $this->company);
        [$items, $conversions] = $active === null
            ? [$pull('items'), $pull('unit-conversions')]
            : Catalog::in($active, fn (): array => [$pull('items'), $pull('unit-conversions')]);

        expect($items)->toHaveCount(1)
            ->and($items[0]['base_unit'])->toBeNull()
            ->and($items[0]['category'])->toBeNull()
            ->and($items[0]['units'])->toHaveCount(1)
            ->and($items[0]['units'][0]['id'])->toBe($this->itemUnit->id)
            ->and($items[0]['units'][0]['unit'])->toBeNull()
            ->and($conversions[0]['from_unit']['code'])->toBe('BOX')
            ->and($conversions[0]['to_unit'])->toBeNull()
            ->and(json_encode([$items, $conversions]))->not->toContain('THEIRS');
    }
});

it('attributes each company\'s tombstones to that company', function (string $name): void {
    $adapter = ($this->adapter)($name);
    $table = $adapter->table();
    $theirs = catalogSet($this->other)[$name][0];
    $mine = (string) DB::table($table)->where('company_id', $this->company)->value('id');
    $parents = DB::table($table)->whereIn('id', [$mine, $theirs])->pluck($adapter->parentKey() ?? 'id', 'id');
    $soft = Schema::hasColumn($table, 'deleted_at');

    foreach ([$mine, $theirs] as $id) {
        $soft
            ? DB::table($table)->where('id', $id)->update(['deleted_at' => now()])
            : DB::table($table)->where('id', $id)->delete();
    }

    foreach ([$mine => $this->company, $theirs => $this->other] as $id => $company) {
        $tombstone = Sync::tombstone($table, $id);

        expect($tombstone)->not->toBeNull()
            ->and($tombstone->reason)->toBe($soft ? 'soft_deleted' : 'deleted')
            ->and($tombstone->company_id)->toBe($company)
            ->and($tombstone->parent_id)->toBe($adapter->parentKey() === null ? null : $parents[$id])
            ->and($adapter->query($company)->whereKey($id)->exists())->toBeFalse();
    }
})->with(['units', 'unit-conversions', 'item-categories', 'items', 'items.variants', 'items.barcodes', 'price-lists', 'price-lists.lines']);

it('touches the embedding rows when an embedded unit or category changes, without touching their version', function (Closure $change, array $touched): void {
    $tables = ['items' => $this->item->id, 'unit_conversions' => $this->conversion->id];
    $before = array_map(fn (string $id, string $table): string => ($this->txid)($table, $id), $tables, array_keys($tables));
    $before = array_combine(array_keys($tables), $before);
    $item = Item::query()->withoutCompanyScope()->whereKey($this->item->id)->firstOrFail();

    $change($this);

    foreach ($tables as $table => $id) {
        $moved = ($this->txid)($table, $id) !== $before[$table];
        expect($moved)->toBe(in_array($table, $touched, true), "{$table} touched");
    }

    $after = Item::query()->withoutCompanyScope()->whereKey($this->item->id)->firstOrFail();
    expect($after->version)->toBe($item->version)
        ->and($after->updated_at?->toIso8601String())->toBe($item->updated_at?->toIso8601String());
})->with([
    'base unit rename' => [fn ($t) => DB::table('units')->where('id', $t->pcs->id)->update(['name' => 'Piece']), ['items']],
    'base unit symbol' => [fn ($t) => DB::table('units')->where('id', $t->pcs->id)->update(['symbol' => 'pc']), ['items']],
    'item unit rename' => [fn ($t) => DB::table('units')->where('id', $t->box->id)->update(['code' => 'CRATE']), ['items', 'unit_conversions']],
    'unit soft delete' => [fn ($t) => DB::table('units')->where('id', $t->box->id)->update(['deleted_at' => now()]), ['items', 'unit_conversions']],
    'unit change outside the embeds' => [fn ($t) => DB::table('units')->where('id', $t->pcs->id)->update(['is_active' => false]), []],
    'category rename' => [fn ($t) => DB::table('item_categories')->where('id', $t->category->id)->update(['name' => 'Renamed']), ['items']],
    'unrelated unit rename' => [fn ($t) => DB::table('units')->where('id', Catalog::unit($t->company, 'OTHER')->id)->update(['name' => 'Other']), []],
]);

it('delivers the new embedded name once a unit or category is renamed', function (): void {
    $before = Sync::txidOf('items', $this->item->id);
    DB::table('units')->where('id', $this->pcs->id)->update(['name' => 'Piece']);
    DB::table('units')->where('id', $this->box->id)->update(['code' => 'CRATE']);
    DB::table('item_categories')->where('id', $this->category->id)->update(['name' => 'Renamed']);

    $items = pulled(($this->adapter)('items'), $this->company);
    $conversions = pulled(($this->adapter)('unit-conversions'), $this->company);

    expect(Sync::txidOf('items', $this->item->id)->greaterThan($before))->toBeTrue()
        ->and(Sync::belowHorizon('items'))->toContain($this->item->id)
        ->and($items[0]['base_unit']['name'])->toBe('Piece')
        ->and($items[0]['category']['name'])->toBe('Renamed')
        ->and($items[0]['units'][0]['unit']['code'])->toBe('CRATE')
        ->and($conversions[0]['from_unit']['code'])->toBe('CRATE');
});

it('does not touch another company\'s rows that point at a renamed unit', function (): void {
    $theirs = catalogSet($this->other);
    DB::table('items')->where('id', $theirs['items'][0])->update(['base_unit_id' => $this->pcs->id]);
    $before = ($this->txid)('items', $theirs['items'][0]);
    $mine = ($this->txid)('items', $this->item->id);

    DB::table('units')->where('id', $this->pcs->id)->update(['name' => 'Piece']);

    expect(($this->txid)('items', $theirs['items'][0]))->toBe($before)
        ->and(($this->txid)('items', $this->item->id))->not->toBe($mine);
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
