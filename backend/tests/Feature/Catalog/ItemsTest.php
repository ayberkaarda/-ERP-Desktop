<?php

declare(strict_types=1);

use App\Modules\Catalog\Contracts\ItemUsageChecker;
use App\Modules\Catalog\Events\ItemCreated;
use App\Modules\Catalog\Events\ItemUpdated;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Identity\Models\Activity;
use App\Modules\Reference\Contracts\TaxCodeLookup;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Models\TaxCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->admin = Actors::user(['items.view', 'items.create', 'items.update', 'items.delete']);
    $this->viewer = Actors::user(['items.view']);
    $this->other = Actors::company();
    $this->pcs = Catalog::unit($this->company, 'PCS');
    $this->year = now()->utc()->format('Y');
});

it('generates gapless codes from the item number sequence and accepts manual codes', function (): void {
    $first = Catalog::post($this->admin, $this->company, 'items', ['name' => 'Bolt', 'type' => 'stock', 'base_unit_id' => $this->pcs->id])
        ->assertCreated()->assertJsonPath('data.tracking', 'none')->assertJsonPath('data.base_unit.code', 'PCS')->json('data.code');
    $second = Catalog::post($this->admin, $this->company, 'items', ['name' => 'Nut', 'type' => 'stock', 'base_unit_id' => $this->pcs->id])
        ->assertCreated()->json('data.code');

    expect($first)->toBe("ITM{$this->year}000001")->and($second)->toBe("ITM{$this->year}000002");

    Catalog::post($this->admin, $this->company, 'items', ['code' => 'MANUAL-1', 'name' => 'Washer', 'type' => 'stock', 'base_unit_id' => $this->pcs->id])
        ->assertCreated()->assertJsonPath('data.code', 'MANUAL-1');
    Catalog::post($this->admin, $this->company, 'items', ['code' => 'MANUAL-1', 'name' => 'Dup', 'type' => 'stock', 'base_unit_id' => $this->pcs->id])
        ->assertStatus(422)->assertJsonValidationErrors(['code'], 'errors.fields');

    // A manual code that collides with the next generated one is skipped.
    Catalog::item($this->company, $this->pcs, ['code' => "ITM{$this->year}000003"]);
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'Pin', 'type' => 'stock', 'base_unit_id' => $this->pcs->id])
        ->assertCreated()->assertJsonPath('data.code', "ITM{$this->year}000004");

    // Sequences are per company.
    $otherAdmin = Actors::user(['items.create'], $this->other);
    $otherPcs = Catalog::unit($this->other, 'PCS');
    Catalog::post($otherAdmin, $this->other, 'items', ['name' => 'Bolt', 'type' => 'stock', 'base_unit_id' => $otherPcs->id])
        ->assertCreated()->assertJsonPath('data.code', "ITM{$this->year}000001");
});

it('stores decimals and json attributes as given and audits changes', function (): void {
    $id = Catalog::post($this->admin, $this->company, 'items', [
        'name' => 'Flour', 'type' => 'stock', 'base_unit_id' => $this->pcs->id, 'tracking' => 'lot', 'has_expiry' => true,
        'min_stock' => '10.5', 'reorder_point' => '20', 'attributes' => ['origin' => 'TR', 'organic' => true],
    ])->assertCreated()
        ->assertJsonPath('data.min_stock', '10.500000')->assertJsonPath('data.reorder_point', '20.000000')
        ->assertJsonPath('data.attributes.origin', 'TR')->assertJsonPath('data.has_expiry', true)->json('data.id');

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$id}", ['name' => 'Wheat flour', 'version' => 1])
        ->assertOk()->assertJsonPath('data.version', 2);

    expect(Activity::withoutCompanyScope()->where('subject_id', $id)->where('subject_type', 'item')->pluck('event')->all())->toBe(['created', 'updated']);

    foreach (['1.1234567', '-1', '1e2', 12] as $bad) {
        Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$id}", ['min_stock' => $bad, 'version' => 2])
            ->assertStatus(422)->assertJsonValidationErrors(['min_stock'], 'errors.fields');
    }
});

it('dispatches ItemCreated and ItemUpdated only after commit', function (): void {
    Event::fake([ItemCreated::class, ItemUpdated::class]);

    DB::beginTransaction();
    $id = Catalog::post($this->admin, $this->company, 'items', ['name' => 'Gear', 'type' => 'stock', 'base_unit_id' => $this->pcs->id])->json('data.id');
    Event::assertNotDispatched(ItemCreated::class);
    DB::commit();

    Event::assertDispatched(ItemCreated::class, fn (ItemCreated $e): bool => $e->itemId === $id && $e->companyId === $this->company);

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$id}", ['name' => 'Big gear', 'is_active' => false, 'version' => 1])->assertOk();
    Event::assertDispatched(ItemUpdated::class, fn (ItemUpdated $e): bool => $e->itemId === $id && $e->changed === ['name', 'is_active']);

    // A no-op update changes nothing and announces nothing.
    Event::fake([ItemUpdated::class]);
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$id}", ['name' => 'Big gear', 'version' => 2])->assertOk();
    Event::assertNotDispatched(ItemUpdated::class);
});

it('refuses tracking or expiry on service items', function (): void {
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'Consulting', 'type' => 'service', 'base_unit_id' => $this->pcs->id, 'tracking' => 'serial'])
        ->assertStatus(422)->assertJsonValidationErrors(['tracking'], 'errors.fields');
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'Consulting', 'type' => 'service', 'base_unit_id' => $this->pcs->id, 'has_expiry' => true])
        ->assertStatus(422);

    $stock = Catalog::item($this->company, $this->pcs, ['tracking' => 'lot']);
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$stock->id}", ['type' => 'service', 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['tracking'], 'errors.fields');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$stock->id}", ['type' => 'service', 'tracking' => 'none', 'version' => 1])
        ->assertOk()->assertJsonPath('data.type', 'service');
});

it('validates units, categories and tax codes', function (): void {
    $foreignUnit = Catalog::unit($this->other, 'PCS');
    $foreignCategory = Catalog::category($this->other, 'CAT');

    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'stock', 'base_unit_id' => $foreignUnit->id])
        ->assertStatus(422)->assertJsonValidationErrors(['base_unit_id'], 'errors.fields');
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'stock', 'base_unit_id' => $this->pcs->id, 'category_id' => $foreignCategory->id])
        ->assertStatus(422)->assertJsonValidationErrors(['category_id'], 'errors.fields');
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'gadget', 'base_unit_id' => $this->pcs->id])
        ->assertStatus(422)->assertJsonValidationErrors(['type'], 'errors.fields');
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'stock', 'base_unit_id' => $this->pcs->id, 'default_tax_code_id' => 'KDV20'])
        ->assertStatus(422)->assertJsonValidationErrors(['default_tax_code_id'], 'errors.fields');

    // Tax codes are checked through the Reference lookup (seeded official codes).
    $this->seed(ReferenceSeeder::class);
    $vat = TaxCode::query()->where('code', 'VAT20')->value('id');
    $unknown = (string) Str::uuid7();
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'stock', 'base_unit_id' => $this->pcs->id, 'default_tax_code_id' => $unknown])
        ->assertStatus(422)->assertJsonValidationErrors(['default_tax_code_id'], 'errors.fields');
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'stock', 'base_unit_id' => $this->pcs->id, 'default_tax_code_id' => $vat, 'purchase_tax_code_id' => $vat])
        ->assertCreated()->assertJsonPath('data.default_tax_code_id', $vat);

    // Without the Reference module the id is kept as an opaque uuid.
    $lookup = app(TaxCodeLookup::class);
    app()->offsetUnset(TaxCodeLookup::class);
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'stock', 'base_unit_id' => $this->pcs->id, 'default_tax_code_id' => $unknown])
        ->assertCreated()->assertJsonPath('data.default_tax_code_id', $unknown);
    app()->instance(TaxCodeLookup::class, $lookup);

    $deleted = Catalog::unit($this->company, 'OLD');
    Catalog::in($this->company, fn () => $deleted->delete());
    Catalog::post($this->admin, $this->company, 'items', ['name' => 'X', 'type' => 'stock', 'base_unit_id' => $deleted->id])
        ->assertStatus(422)->assertJsonValidationErrors(['base_unit_id'], 'errors.fields');
});

it('locks the base unit once alternate units exist', function (): void {
    $box = Catalog::unit($this->company, 'BOX');
    $kg = Catalog::unit($this->company, 'KG');
    $item = Catalog::item($this->company, $this->pcs);

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$item->id}", ['base_unit_id' => $kg->id, 'version' => 1])
        ->assertOk()->assertJsonPath('data.base_unit_id', $kg->id);

    Catalog::itemUnit($this->company, $item, $box, '12');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$item->id}", ['base_unit_id' => $this->pcs->id, 'version' => 2])
        ->assertStatus(422)->assertJsonValidationErrors(['base_unit_id'], 'errors.fields');
});

it('filters by type, tracking, activity and category subtree and searches code, name, barcode and sku', function (): void {
    $root = Catalog::category($this->company, 'ROOT');
    $child = Catalog::category($this->company, 'CHILD', $root);
    $elsewhere = Catalog::category($this->company, 'ELSE');

    $a = Catalog::item($this->company, $this->pcs, ['code' => 'A-1', 'name' => 'Steel bolt', 'category_id' => $root->id]);
    $b = Catalog::item($this->company, $this->pcs, ['code' => 'B-1', 'name' => 'Copper wire', 'category_id' => $child->id, 'tracking' => 'serial']);
    $c = Catalog::item($this->company, $this->pcs, ['code' => 'C-1', 'name' => 'Repair', 'type' => 'service', 'category_id' => $elsewhere->id, 'is_active' => false]);
    Catalog::in($this->company, fn () => ItemBarcode::query()->make(['barcode' => '8690000000005', 'type' => 'ean13', 'unit_id' => $this->pcs->id])
        ->forceFill(['item_id' => $b->id])->save());
    Catalog::variant($this->company, $c, 'REP-XL');
    Catalog::item($this->other, Catalog::unit($this->other, 'PCS'), ['code' => 'A-2', 'name' => 'Steel bolt']);

    $ids = fn (string $query): array => Catalog::as($this->viewer, $this->company)->getJson("/api/v1/items?{$query}")->assertOk()->json('data.*.id');

    expect($ids("filter[category]={$root->id}&sort=code"))->toBe([$a->id, $b->id])
        ->and($ids("filter[category]={$child->id}"))->toBe([$b->id])
        ->and($ids('filter[type]=service'))->toBe([$c->id])
        ->and($ids('filter[tracking]=serial'))->toBe([$b->id])
        ->and($ids('filter[is_active]=1&sort=code'))->toBe([$a->id, $b->id])
        ->and($ids('q=steel'))->toBe([$a->id])
        ->and($ids('q=869000'))->toBe([$b->id])
        ->and($ids('q=rep-x'))->toBe([$c->id])
        ->and($ids('q=c-1'))->toBe([$c->id])
        ->and($ids('q=100%25'))->toBe([]);

    Catalog::as($this->viewer, $this->company)->getJson('/api/v1/items?filter[category]=nope')->assertStatus(422);
    Catalog::as($this->viewer, $this->company)->getJson('/api/v1/items?filter[colour]=red')->assertStatus(422);
    Catalog::as($this->viewer, $this->company)->getJson('/api/v1/items?sort=-secret')->assertStatus(422);
});

it('has pg_trgm indexes behind the searched columns', function (): void {
    $indexes = collect(DB::select("select indexname, indexdef from pg_indexes where tablename in ('items', 'item_barcodes', 'item_variants')"))
        ->filter(fn (object $i): bool => str_contains((string) $i->indexdef, 'gin_trgm_ops'))
        ->pluck('indexname')->all();

    expect($indexes)->toContain('items_name_trgm', 'items_code_trgm', 'item_barcodes_barcode_trgm', 'item_variants_sku_trgm');
});

it('soft deletes unused items, frees their barcodes and refuses used ones', function (): void {
    $item = Catalog::item($this->company, $this->pcs);
    Catalog::in($this->company, fn () => ItemBarcode::query()->make(['barcode' => 'BC-1', 'unit_id' => $this->pcs->id, 'is_primary' => true])
        ->forceFill(['item_id' => $item->id])->save());

    Catalog::as($this->viewer, $this->company)->deleteJson("/api/v1/items/{$item->id}")->assertStatus(403);
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/items/{$item->id}")->assertNoContent();
    expect(Catalog::in($this->company, fn () => Item::withTrashed()->find($item->id)?->trashed()))->toBeTrue()
        ->and(Catalog::in($this->company, fn () => ItemBarcode::query()->where('barcode', 'BC-1')->exists()))->toBeFalse();
    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/items/{$item->id}")->assertNotFound();

    // In use by a price list (in-module checker).
    $priced = Catalog::item($this->company, $this->pcs);
    Catalog::line($this->company, Catalog::priceList($this->company), $priced, $this->pcs, '5');
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/items/{$priced->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['item'], 'errors.fields');
});

it('asks usage checkers registered by other modules before deleting', function (): void {
    $used = Catalog::item($this->company, $this->pcs);
    $free = Catalog::item($this->company, $this->pcs);

    $checker = new class($used->id) implements ItemUsageChecker
    {
        public function __construct(private readonly string $used) {}

        public function isUsed(string $itemId): bool
        {
            return $itemId === $this->used;
        }
    };
    app()->instance($checker::class, $checker);
    app()->tag([$checker::class], ItemUsageChecker::TAG);

    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/items/{$used->id}")->assertStatus(422);
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/items/{$free->id}")->assertNoContent();

    // A used item keeps its base unit too.
    $kg = Catalog::unit($this->company, 'KG');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$used->id}", ['base_unit_id' => $kg->id, 'version' => 1])->assertStatus(422);
});

it('isolates items between companies and enforces versions', function (): void {
    $foreign = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'));
    $item = Catalog::item($this->company, $this->pcs);

    Catalog::as($this->admin, $this->company)->getJson("/api/v1/items/{$foreign->id}")->assertNotFound();
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$foreign->id}", ['name' => 'x', 'version' => 1])->assertNotFound();
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/items/{$foreign->id}")->assertNotFound();
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/items/{$item->id}", ['name' => 'x', 'version' => 5])
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    Catalog::as($this->viewer, $this->company)->patchJson("/api/v1/items/{$item->id}", ['name' => 'x', 'version' => 1])->assertStatus(403);
    Catalog::as($this->admin, $this->company)->postJson('/api/v1/items', ['name' => 'x', 'type' => 'stock', 'base_unit_id' => $this->pcs->id])
        ->assertStatus(400)->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REQUIRED');
});
