<?php

declare(strict_types=1);

use App\Core\Documents\VersionConflictException;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemCategory;
use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Services\DiscountRuleService;
use App\Modules\Catalog\Services\ItemService;
use App\Modules\Catalog\Services\PriceListService;
use App\Modules\Catalog\Services\ReferenceGuards;
use App\Modules\Catalog\Services\UnitService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Catalog\FakeCurrencyLookup;
use Tests\Support\Catalog\FakePartyLookup;
use Tests\Support\Catalog\FakeTaxCodeLookup;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->admin = Actors::user(Catalog::ALL);
    $this->pcs = Catalog::unit($this->company, 'PCS');
    $this->box = Catalog::unit($this->company, 'BOX');
    $this->pack = Catalog::unit($this->company, 'PACK');
});

/** Field names of the validation error thrown by $fn. */
function failedFields(Closure $fn): array
{
    try {
        $fn();
    } catch (ValidationException $e) {
        return array_keys($e->errors());
    }

    return [];
}

it('checks every pair of item units reachable in the graph, not only paths to the base', function (): void {
    // Base PCS has no graph edge at all; BOX and PACK are connected only to each other.
    $item = Catalog::item($this->company, $this->pcs, ['code' => 'RATIO']);
    Catalog::itemUnit($this->company, $item, $this->box, '12');
    Catalog::itemUnit($this->company, $item, $this->pack, '3');

    // 12/3 = 4 packs per box; a graph edge saying 5 contradicts the item.
    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $this->box->id, 'to_unit_id' => $this->pack->id, 'factor' => '5'])
        ->assertStatus(422)->assertJsonValidationErrors(['factor'], 'errors.fields');
    $edge = Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $this->box->id, 'to_unit_id' => $this->pack->id, 'factor' => '4'])
        ->assertCreated()->json('data.id');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/unit-conversions/{$edge}", ['factor' => '6', 'version' => 1])->assertStatus(422);

    // The other direction: the edge exists first, the item units must agree with it.
    $other = Catalog::item($this->company, $this->pcs);
    Catalog::post($this->admin, $this->company, "items/{$other->id}/units", ['unit_id' => $this->box->id, 'factor' => '12'])->assertCreated();
    Catalog::post($this->admin, $this->company, "items/{$other->id}/units", ['unit_id' => $this->pack->id, 'factor' => '2.4'])
        ->assertStatus(422)->assertJsonValidationErrors(['factor'], 'errors.fields');
    $pack = Catalog::post($this->admin, $this->company, "items/{$other->id}/units", ['unit_id' => $this->pack->id, 'factor' => '3'])
        ->assertCreated()->json('data.id');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$other->id}/units/{$pack}", ['factor' => '4', 'version' => 1])->assertStatus(422);
});

it('checks the base unit only after locking the item row', function (): void {
    $item = Catalog::item($this->company, $this->pcs);
    DB::enableQueryLog();

    Catalog::in($this->company, fn () => app(ItemService::class)->update($item, ['base_unit_id' => $this->box->id], 1));

    $sql = array_column(DB::getQueryLog(), 'query');
    $lock = collect($sql)->search(fn (string $q): bool => str_contains($q, 'from "items"') && str_contains($q, 'for update'));
    $check = collect($sql)->search(fn (string $q): bool => str_contains($q, 'from "item_units"'));

    expect($lock)->toBeInt()->and($check)->toBeInt()->and($lock)->toBeLessThan($check);
});

it('re-validates line and rule references inside the write transaction', function (): void {
    $item = Catalog::item($this->company, $this->pcs);
    $variant = Catalog::variant($this->company, $item, 'GONE-V');
    $list = Catalog::priceList($this->company);
    // Deleted after the request was validated.
    Catalog::in($this->company, function () use ($item, $variant): void {
        $variant->delete();
        Item::query()->whereKey($item->id)->firstOrFail()->delete();
    });

    Catalog::in($this->company, function () use ($item, $variant, $list): void {
        $lines = app(PriceListService::class);
        expect(failedFields(fn () => $lines->createLine($list, ['item_id' => $item->id, 'unit_id' => $this->pcs->id, 'price' => '1'])))->toBe(['item_id'])
            ->and(failedFields(fn () => $lines->upsertLines($list, [['item_id' => $item->id, 'unit_id' => $this->pcs->id, 'price' => '1', 'variant_id' => $variant->id]])))
            ->toBe(['lines.0.item_id'])
            ->and(failedFields(fn () => app(DiscountRuleService::class)->create(['code' => 'R', 'name' => 'R', 'scope' => 'item', 'scope_ref' => $item->id, 'discount_percent' => '5'])))
            ->toBe(['scope_ref'])
            ->and(PriceListLine::query()->count())->toBe(0)
            ->and(DiscountRule::query()->count())->toBe(0);
    });

    $live = Catalog::item($this->company, $this->pcs);
    $deletedVariant = Catalog::variant($this->company, $live, 'GONE-2');
    Catalog::in($this->company, fn () => $deletedVariant->delete());
    expect(Catalog::in($this->company, fn () => failedFields(fn () => app(PriceListService::class)->upsertLines($list, [
        ['item_id' => $live->id, 'unit_id' => $this->pcs->id, 'price' => '1', 'variant_id' => $deletedVariant->id],
    ]))))->toBe(['lines.0.variant_id']);
});

it('refuses references to units and categories deleted in the meantime', function (): void {
    $deletedUnit = Catalog::unit($this->company, 'OLD');
    $category = Catalog::category($this->company, 'OLDCAT');
    Catalog::in($this->company, function () use ($deletedUnit, $category): void {
        $deletedUnit->delete();
        $category->delete();
    });

    Catalog::in($this->company, function () use ($deletedUnit, $category): void {
        $items = app(ItemService::class);
        expect(failedFields(fn () => $items->create(['name' => 'X', 'type' => 'stock', 'base_unit_id' => $deletedUnit->id])))->toBe(['base_unit_id'])
            ->and(failedFields(fn () => $items->create(['name' => 'X', 'type' => 'stock', 'base_unit_id' => $this->pcs->id, 'category_id' => $category->id])))->toBe(['category_id'])
            ->and(Item::query()->count())->toBe(0);
    });
});

it('checks the delete version against the locked row, not the loaded copy', function (): void {
    $unit = Catalog::unit($this->company, 'STALE');
    $item = Catalog::item($this->company, $this->pcs);
    // Someone saved a newer version after these copies were loaded.
    Unit::withoutCompanyScope()->whereKey($unit->id)->update(['version' => 2]);
    Item::withoutCompanyScope()->whereKey($item->id)->update(['version' => 2]);

    Catalog::in($this->company, function () use ($unit, $item): void {
        expect(fn () => app(UnitService::class)->delete($unit, 1))->toThrow(VersionConflictException::class)
            ->and(fn () => app(ItemService::class)->delete($item, 1))->toThrow(VersionConflictException::class)
            ->and(Unit::query()->whereKey($unit->id)->exists())->toBeTrue();

        app(UnitService::class)->delete($unit, 2);
        expect(Unit::query()->whereKey($unit->id)->exists())->toBeFalse();
    });
});

it('drops the lines of a deleted price list so their items can be deleted', function (): void {
    $item = Catalog::item($this->company, $this->pcs);
    $list = Catalog::priceList($this->company);
    Catalog::line($this->company, $list, $item, $this->pcs, '5');

    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/items/{$item->id}")->assertStatus(422);
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/price-lists/{$list->id}?version=1")->assertNoContent();

    expect(Catalog::in($this->company, fn () => PriceListLine::query()->count()))->toBe(0);
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/items/{$item->id}")->assertNoContent();
});

it('answers 403 without the permission whether or not the record exists', function (): void {
    $viewer = Actors::user(['items.view']);
    $nobody = Actors::user();
    $missing = (string) Str::uuid7();

    Catalog::as($viewer, $this->company)->patchJson("/api/v1/units/{$missing}", ['name' => 'x', 'version' => 1])->assertStatus(403);
    Catalog::as($viewer, $this->company)->patchJson("/api/v1/units/{$this->pcs->id}", ['name' => 'x', 'version' => 1])->assertStatus(403);
    Catalog::as($viewer, $this->company)->deleteJson("/api/v1/units/{$missing}")->assertStatus(403);
    Catalog::as($viewer, $this->company)->postJson("/api/v1/items/{$missing}/variants", [], ['Idempotency-Key' => (string) Str::uuid7()])->assertStatus(403);
    Catalog::as($nobody, $this->company)->getJson("/api/v1/items/{$missing}")->assertStatus(403);
    Catalog::as($nobody, $this->company)->getJson("/api/v1/items/{$missing}/barcodes")->assertStatus(403);

    // With the permission, a missing record is a plain 404.
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/units/{$missing}", ['name' => 'x', 'version' => 1])->assertNotFound();
    Catalog::as($this->admin, $this->company)->getJson("/api/v1/items/{$missing}")->assertNotFound();
});

it('bumps version and updated_at of descendants when a subtree moves', function (): void {
    $a = Catalog::category($this->company, 'A');
    $b = Catalog::category($this->company, 'B');
    $child = Catalog::category($this->company, 'A1', $a);
    $grandchild = Catalog::category($this->company, 'A11', $child);
    ItemCategory::withoutCompanyScope()->whereKey($grandchild->id)->update(['updated_at' => now()->subDay()]);

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/item-categories/{$a->id}", ['parent_id' => $b->id, 'version' => 1])->assertOk();

    $fresh = Catalog::in($this->company, fn () => ItemCategory::query()->findOrFail($grandchild->id));
    expect($fresh->version)->toBe(2)
        ->and($fresh->updated_at?->isToday())->toBeTrue()
        ->and(Catalog::in($this->company, fn () => ItemCategory::query()->findOrFail($child->id)->version))->toBe(2);
});

it('rejects a null or empty item code on update', function (): void {
    $item = Catalog::item($this->company, $this->pcs);

    foreach ([null, ''] as $code) {
        Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$item->id}", ['code' => $code, 'version' => 1])
            ->assertStatus(422)->assertJsonValidationErrors(['code'], 'errors.fields');
    }
});

it('keeps generated SKUs within the column for the longest item codes', function (): void {
    $code = str_repeat('X', 64);
    $item = Catalog::item($this->company, $this->pcs, ['code' => $code]);

    $sku = Catalog::post($this->admin, $this->company, "items/{$item->id}/variants", [])->assertCreated()->json('data.sku');
    expect(strlen($sku))->toBe(64)->and($sku)->toEndWith('-001');
    Catalog::post($this->admin, $this->company, "items/{$item->id}/variants", [])->assertCreated()->assertJsonPath('data.sku', str_repeat('X', 60).'-002');
});

it('uses the contracts of providing modules only when they exist and are bound', function (): void {
    $party = (string) Str::uuid7();
    $guards = fn (): ReferenceGuards => new ReferenceGuards(app(), [
        'tax_codes' => FakeTaxCodeLookup::class, 'currencies' => FakeCurrencyLookup::class, 'parties' => FakePartyLookup::class,
    ]);

    // Interface missing: opaque ids are accepted.
    $absent = new ReferenceGuards(app(), ['tax_codes' => 'Missing\\TaxCodes', 'currencies' => 'Missing\\Currencies', 'parties' => 'Missing\\Parties']);
    expect($absent->taxCodeExists($party))->toBeTrue()
        ->and($absent->currencyExists('XYZ'))->toBeTrue()
        ->and($absent->partyExists($party))->toBeTrue()
        ->and($absent->partyPriceListId($party))->toBeNull();

    // Interface present but not bound: still accepted.
    expect($guards()->taxCodeExists($party))->toBeTrue()->and($guards()->partyExists($party))->toBeTrue();

    // Bound: the lookup decides.
    app()->instance(FakeTaxCodeLookup::class, new class implements FakeTaxCodeLookup
    {
        public function find(string $id): mixed
        {
            return $id === 'known' ? ['id' => $id] : null;
        }
    });
    app()->instance(FakeCurrencyLookup::class, new class implements FakeCurrencyLookup
    {
        public function exists(string $code): bool
        {
            return $code === 'TRY';
        }
    });
    app()->instance(FakePartyLookup::class, new class($party) implements FakePartyLookup
    {
        public function __construct(private readonly string $party) {}

        public function find(string $id): mixed
        {
            return $id === $this->party ? (object) ['id' => $id, 'price_list_id' => 'list-1'] : null;
        }
    });

    expect($guards()->taxCodeExists('known'))->toBeTrue()
        ->and($guards()->taxCodeExists('other'))->toBeFalse()
        ->and($guards()->currencyExists('TRY'))->toBeTrue()
        ->and($guards()->currencyExists('XYZ'))->toBeFalse()
        ->and($guards()->partyExists($party))->toBeTrue()
        ->and($guards()->partyExists((string) Str::uuid7()))->toBeFalse()
        ->and($guards()->partyPriceListId($party))->toBe('list-1')
        ->and($guards()->partyPriceListId((string) Str::uuid7()))->toBeNull();
});
