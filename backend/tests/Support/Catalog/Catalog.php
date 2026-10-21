<?php

declare(strict_types=1);

namespace Tests\Support\Catalog;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemCategory;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use App\Modules\Catalog\Services\CategoryTree;
use App\Modules\Catalog\Services\ReferenceGuards;
use Closure;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\Identity;

/**
 * Fixtures and an API client for catalog tests. Records are created inside the given company.
 */
final class Catalog
{
    public const array ALL = [
        'items.view', 'items.create', 'items.update', 'items.delete', 'units.manage', 'item_categories.manage',
        'price_lists.view', 'price_lists.create', 'price_lists.update', 'price_lists.delete',
        'discount_rules.manage', 'pricing.view',
    ];

    /**
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public static function in(string $company, Closure $fn): mixed
    {
        return app(CompanyContext::class)->runAs($company, $fn);
    }

    public static function unit(string $company, string $code, array $attributes = []): Unit
    {
        return self::in($company, fn (): Unit => Unit::factory()->create(['code' => $code, 'name' => $code, ...$attributes]));
    }

    public static function conversion(string $company, Unit $from, Unit $to, string $factor): UnitConversion
    {
        return self::in($company, fn (): UnitConversion => UnitConversion::query()->create([
            'from_unit_id' => $from->id, 'to_unit_id' => $to->id, 'factor' => $factor,
        ]));
    }

    public static function item(string $company, Unit $base, array $attributes = []): Item
    {
        return self::in($company, fn (): Item => Item::factory()->create(['base_unit_id' => $base->id, ...$attributes]));
    }

    public static function itemUnit(string $company, Item $item, Unit $unit, string $factor): ItemUnit
    {
        return self::in($company, function () use ($item, $unit, $factor): ItemUnit {
            $row = new ItemUnit(['unit_id' => $unit->id, 'factor' => $factor]);
            $row->item_id = $item->id;
            $row->save();

            return $row;
        });
    }

    public static function variant(string $company, Item $item, string $sku): ItemVariant
    {
        return self::in($company, function () use ($item, $sku): ItemVariant {
            $variant = new ItemVariant(['sku' => $sku]);
            $variant->item_id = $item->id;
            $variant->save();

            return $variant;
        });
    }

    public static function category(string $company, string $code, ?ItemCategory $parent = null): ItemCategory
    {
        return self::in($company, fn (): ItemCategory => app(CategoryTree::class)->create([
            'code' => $code, 'name' => $code, 'parent_id' => $parent?->id,
        ]));
    }

    public static function priceList(string $company, array $attributes = []): PriceList
    {
        return self::in($company, fn (): PriceList => PriceList::query()->create([
            'code' => 'PL'.Str::upper(Str::random(6)), 'name' => 'List', 'currency_code' => 'TRY', ...$attributes,
        ]));
    }

    public static function line(string $company, PriceList $list, Item $item, Unit $unit, string $price, array $attributes = []): PriceListLine
    {
        return self::in($company, function () use ($list, $item, $unit, $price, $attributes): PriceListLine {
            $line = new PriceListLine(['item_id' => $item->id, 'unit_id' => $unit->id, 'price' => $price, 'min_qty' => '0', ...$attributes]);
            $line->price_list_id = $list->id;
            $line->save();

            return $line;
        });
    }

    /**
     * Stands in for the Parties module: party id => default price list id.
     *
     * @param  array<string, string>  $lists
     */
    public static function fakePartyLists(array $lists): void
    {
        app()->instance(ReferenceGuards::class, new class(app(), $lists) extends ReferenceGuards
        {
            /** @param array<string, string> $lists */
            public function __construct(\Illuminate\Contracts\Container\Container $app, private readonly array $lists)
            {
                parent::__construct($app);
            }

            public function partyPriceListId(string $partyId): ?string
            {
                return $this->lists[$partyId] ?? null;
            }
        });
    }

    /**
     * Acting user + active company headers; per-request state is reset like on a real server.
     */
    public static function as(User $user, string $company): mixed
    {
        Identity::fresh();

        return test()->actingAs($user, 'web')->withHeaders(['X-Company-Id' => $company, 'Accept' => 'application/json']);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return TestResponse<Response>
     */
    public static function post(User $user, string $company, string $uri, array $data): TestResponse
    {
        return self::as($user, $company)->postJson('/api/v1/'.$uri, $data, ['Idempotency-Key' => (string) Str::uuid7()]);
    }
}
