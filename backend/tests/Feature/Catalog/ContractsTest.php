<?php

declare(strict_types=1);

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Contracts\ItemUsageChecker;
use App\Modules\Catalog\Contracts\PriceListLookup;
use App\Modules\Catalog\Contracts\PriceResolver;
use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Identity\Services\PermissionCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->other = Actors::company();
    $this->pcs = Catalog::unit($this->company, 'PCS', ['symbol' => 'pc']);
    $this->box = Catalog::unit($this->company, 'BOX');
    $this->item = Catalog::item($this->company, $this->pcs, ['code' => 'LOOK-1', 'name' => 'Lookup item', 'tracking' => 'lot']);
    Catalog::itemUnit($this->company, $this->item, $this->box, '12');
    $this->variant = Catalog::variant($this->company, $this->item, 'LOOK-1-V');
    Catalog::in($this->company, fn () => ItemBarcode::query()->make(['barcode' => '4006381333931', 'type' => 'ean13', 'unit_id' => $this->box->id, 'variant_id' => $this->variant->id])
        ->forceFill(['item_id' => $this->item->id])->save());
});

it('binds the catalog contracts', function (): void {
    expect(app(ItemLookup::class))->toBeInstanceOf(ItemLookup::class)
        ->and(app(UnitLookup::class))->toBeInstanceOf(UnitLookup::class)
        ->and(app(PriceListLookup::class))->toBeInstanceOf(PriceListLookup::class)
        ->and(app(PriceResolver::class))->toBeInstanceOf(PriceResolver::class)
        ->and(app(ItemUsageChecker::class))->toBeInstanceOf(ItemUsageChecker::class);
});

it('looks items up by id, code and barcode within the active company only', function (): void {
    Catalog::in($this->company, function (): void {
        $lookup = app(ItemLookup::class);
        $data = $lookup->find($this->item->id);
        $match = $lookup->findByBarcode('4006381333931');

        expect($data?->code)->toBe('LOOK-1')
            ->and($data?->tracking)->toBe('lot')
            ->and($data?->toArray()['base_unit_id'])->toBe($this->pcs->id)
            ->and($lookup->findByCode('LOOK-1')?->id)->toBe($this->item->id)
            ->and($match?->item->id)->toBe($this->item->id)
            ->and($match?->unitId)->toBe($this->box->id)
            ->and($match?->variantId)->toBe($this->variant->id)
            ->and($lookup->exists('garbage'))->toBeFalse()
            ->and($lookup->variantBelongsTo($this->variant->id, $this->item->id))->toBeTrue()
            ->and($lookup->variantBelongsTo($this->variant->id, (string) Str::uuid7()))->toBeFalse();
    });

    Catalog::in($this->other, function (): void {
        $lookup = app(ItemLookup::class);

        expect($lookup->find($this->item->id))->toBeNull()
            ->and($lookup->findByCode('LOOK-1'))->toBeNull()
            ->and($lookup->findByBarcode('4006381333931'))->toBeNull()
            ->and(app(UnitLookup::class)->exists($this->pcs->id))->toBeFalse();
    });
});

it('converts through UnitLookup with decimal strings', function (): void {
    Catalog::in($this->company, function (): void {
        $units = app(UnitLookup::class);

        expect($units->find($this->pcs->id)?->symbol)->toBe('pc')
            ->and($units->convert('2', $this->box->id, $this->pcs->id, $this->item->id))->toBe('24.000000')
            ->and($units->convert('1', $this->pcs->id, $this->box->id, $this->item->id, 4))->toBe('0.0833')
            ->and($units->canConvert($this->box->id, $this->pcs->id))->toBeFalse();
    });
});

it('exposes price lists to other modules', function (): void {
    $list = Catalog::priceList($this->company, ['currency_code' => 'EUR']);

    expect(Catalog::in($this->company, fn () => app(PriceListLookup::class)->currency($list->id)))->toBe('EUR')
        ->and(Catalog::in($this->other, fn () => app(PriceListLookup::class)->exists($list->id)))->toBeFalse()
        ->and(Catalog::in($this->company, fn () => app(PriceListLookup::class)->exists('x')))->toBeFalse();
});

it('declares its permissions with default role grants', function (): void {
    $catalog = app(PermissionCatalog::class);

    expect($catalog->grouped()['catalog'] ?? [])->toContain('items.view', 'units.manage', 'price_lists.update', 'discount_rules.manage', 'pricing.view')
        ->and($catalog->grantsFor('Warehouse'))->toContain('items.view', 'items.create', 'units.manage')
        ->and($catalog->grantsFor('Accountant'))->toContain('pricing.view', 'price_lists.view');
});

it('reads many items at once in batches of 100, within the active company only', function (): void {
    $ids = [$this->item->id];

    for ($i = 0; $i < 230; $i++) {
        $ids[] = Catalog::item($this->company, $this->pcs, ['code' => sprintf('MANY-%03d', $i)])->id;
    }

    $foreign = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'), ['code' => 'FOREIGN'])->id;
    $deleted = Catalog::item($this->company, $this->pcs, ['code' => 'GONE']);
    Catalog::in($this->company, fn () => $deleted->delete());

    Catalog::in($this->company, function () use ($ids, $foreign, $deleted): void {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $found = app(ItemLookup::class)->findMany([...$ids, $ids[0], $foreign, $deleted->id, 'garbage', (string) Str::uuid7()]);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        expect($found)->toHaveCount(231)
            ->and(array_keys($found))->toEqualCanonicalizing($ids)
            ->and($found[$this->item->id]->code)->toBe('LOOK-1')
            ->and($found)->not->toHaveKey($foreign)
            ->and($found)->not->toHaveKey($deleted->id)
            ->and($queries)->toBe(3)
            ->and(app(ItemLookup::class)->findMany([]))->toBe([]);
    });

    Catalog::in($this->other, fn () => expect(array_keys(app(ItemLookup::class)->findMany([...$ids, $foreign])))->toBe([$foreign]));
});
