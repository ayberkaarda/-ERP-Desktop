<?php

declare(strict_types=1);

namespace Tests\Support\Inventory;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Data\StockPosted;
use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Data\StockPostingRequest;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Settings\Services\SettingsService;
use Brick\Math\BigDecimal;
use Closure;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\Accounting\Books;
use Tests\Support\Catalog\Catalog;

/**
 * Stock fixtures: a company bootstrapped like a real one (fixture chart with the inventory accounts,
 * default rules, fiscal year 2027 with the clock at 2027-06-15), Reference warehouses, catalog items,
 * postings through the StockService contract and invariant snapshots.
 */
final class Inv
{
    public const array ALL = [
        'inventory.warehouses.view', 'inventory.warehouses.manage', 'inventory.documents.view', 'inventory.documents.create',
        'inventory.documents.post', 'inventory.documents.reverse', 'inventory.documents.issue_expired', 'inventory.stock.view',
        'inventory.reservations.manage', 'inventory.reports.view',
    ];

    public static function chart(): string
    {
        return dirname(__DIR__, 2).'/Fixtures/Inventory/chart.json';
    }

    public static function boot(): void
    {
        Books::boot(referenceRows: false);
        config(['accounting.chart_path' => self::chart()]);
    }

    public static function company(): string
    {
        return Books::company();
    }

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

    public static function warehouse(string $company, string $code = 'MAIN', string $negative = 'block', bool $default = false): Warehouse
    {
        return self::in($company, fn (): Warehouse => Warehouse::factory()->create([
            'code' => $code, 'name' => $code, 'negative_stock_policy' => $negative, 'is_default' => $default,
        ]));
    }

    public static function location(string $company, Warehouse $warehouse, string $code): Location
    {
        return self::in($company, fn (): Location => Location::factory()->create(['warehouse_id' => $warehouse->id, 'code' => $code]));
    }

    public static function unit(string $company, string $code = 'PCS'): Unit
    {
        return Catalog::unit($company, $code.Str::upper(Str::random(4)));
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function item(string $company, array $attributes = [], ?Unit $unit = null): Item
    {
        return Catalog::item($company, $unit ?? self::unit($company), $attributes);
    }

    public static function fifo(string $company): void
    {
        DB::table('settings')->insert([
            'id' => (string) Str::uuid7(), 'company_id' => $company, 'key' => 'inventory.valuation_method', 'value' => '"fifo"',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        SettingsService::forget($company);
    }

    public static function policy(string $company, string $warehouseId, string $policy): void
    {
        DB::table('stock_warehouse_settings')->updateOrInsert(
            ['warehouse_id' => $warehouseId],
            ['company_id' => $company, 'reservation_policy' => $policy, 'version' => 1, 'created_at' => now(), 'updated_at' => now()],
        );
    }

    /**
     * Posts through the StockService contract with a fresh source.
     *
     * @param  list<StockPostingLine>  $lines
     */
    public static function post(string $company, DocumentType $type, string $warehouse, array $lines, string $date = '2027-06-10', ?string $target = null, ?string $offset = null, ?MovementType $movement = null, ?string $source = null, bool $allowExpired = false): StockPosted
    {
        return app(StockService::class)->post(new StockPostingRequest(
            $company, $type, null, new DateTimeImmutable($date), $warehouse, $target, $lines, $offset,
            'test_document', $source ?? (string) Str::uuid7(), movementType: $movement, allowExpired: $allowExpired,
        ));
    }

    /**
     * @param  array<string, mixed>  $extra  named StockPostingLine arguments
     */
    public static function line(string $item, string $qty, ?string $cost = null, array $extra = []): StockPostingLine
    {
        return new StockPostingLine(...['itemId' => $item, 'quantity' => $qty, 'unitCost' => $cost, ...$extra]);
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    public static function receive(string $company, string $warehouse, string $item, string $qty, string $cost, array $extra = [], string $date = '2027-06-10'): StockPosted
    {
        return self::post($company, DocumentType::Receipt, $warehouse, [self::line($item, $qty, $cost, $extra)], $date);
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    public static function issue(string $company, string $warehouse, string $item, string $qty, array $extra = [], string $date = '2027-06-10'): StockPosted
    {
        return self::post($company, DocumentType::Issue, $warehouse, [self::line($item, $qty, null, $extra)], $date);
    }

    /** @return array{quantity: string, value: string, avg_cost: string} */
    public static function valuation(string $company, string $item, string $warehouse): array
    {
        $row = DB::table('stock_valuations')->where('company_id', $company)->where('item_id', $item)->where('warehouse_id', $warehouse)->first();

        return ['quantity' => (string) ($row->quantity ?? '0'), 'value' => (string) ($row->value ?? '0'), 'avg_cost' => (string) ($row->avg_cost ?? '0')];
    }

    public static function onHand(string $company, string $item, string $warehouse): string
    {
        return (string) BigDecimal::of((string) (DB::table('stock_balances')->where('company_id', $company)->where('item_id', $item)
            ->where('warehouse_id', $warehouse)->sum('on_hand') ?: '0'))->toScale(6);
    }

    /**
     * Stored balances and valuations next to the same figures summed over the movements.
     *
     * @return array{balances: array{0: array<string, string>, 1: array<string, string>}, values: array{0: array<string, string>, 1: array<string, string>}}
     */
    public static function invariants(string $company): array
    {
        $stored = [];

        foreach (DB::table('stock_balances')->where('company_id', $company)->get() as $b) {
            if (BigDecimal::of((string) $b->on_hand)->isZero()) {
                continue;
            }

            $stored["{$b->item_id}|{$b->warehouse_id}|{$b->location_id}|{$b->lot_id}"] = (string) BigDecimal::of((string) $b->on_hand)->toScale(6);
        }

        $computed = [];
        $rows = DB::select("SELECT item_id, warehouse_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid) AS location_id,
            coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) AS lot_id, sum(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) AS qty
            FROM stock_movements WHERE company_id = ? GROUP BY 1, 2, 3, 4", [$company]);

        foreach ($rows as $r) {
            if (BigDecimal::of((string) $r->qty)->isZero()) {
                continue;
            }

            $computed["{$r->item_id}|{$r->warehouse_id}|{$r->location_id}|{$r->lot_id}"] = (string) BigDecimal::of((string) $r->qty)->toScale(6);
        }

        $values = [];

        foreach (DB::table('stock_valuations')->where('company_id', $company)->get() as $v) {
            $values["{$v->item_id}|{$v->warehouse_id}"] = (string) BigDecimal::of((string) $v->value)->toScale(4).'/'.BigDecimal::of((string) $v->quantity)->toScale(6);
        }

        $sums = [];
        $rows = DB::select("SELECT item_id, warehouse_id, sum(CASE WHEN direction = 'in' THEN total_cost ELSE -total_cost END) AS value,
            sum(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) AS qty FROM stock_movements WHERE company_id = ? GROUP BY 1, 2", [$company]);

        foreach ($rows as $r) {
            $sums["{$r->item_id}|{$r->warehouse_id}"] = (string) BigDecimal::of((string) $r->value)->toScale(4).'/'.BigDecimal::of((string) $r->qty)->toScale(6);
        }

        ksort($stored);
        ksort($computed);
        ksort($values);
        ksort($sums);

        return ['balances' => [$stored, $computed], 'values' => [$values, $sums]];
    }

    /** Sum of the valuation values of the company (what the stock account must show). */
    public static function totalValue(string $company): string
    {
        return (string) BigDecimal::of((string) (DB::table('stock_valuations')->where('company_id', $company)->sum('value') ?: '0'))->toScale(4);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return TestResponse<Response>
     */
    public static function postJson(User $user, string $company, string $uri, array $data = []): TestResponse
    {
        return Books::postJson($user, $company, $uri, $data);
    }

    public static function as(User $user, string $company): mixed
    {
        return Books::as($user, $company);
    }
}
