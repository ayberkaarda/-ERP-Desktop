<?php

declare(strict_types=1);

namespace Tests\Support\Sales;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Parties\Models\Party;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Services\CurrencyCatalog;
use App\Modules\Settings\Services\SettingsService;
use Brick\Math\BigDecimal;
use Closure;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Identity;
use Tests\Support\Inventory\Inv;

/**
 * Sales fixtures: a company bootstrapped like a real one (fixture chart with receivable, revenue,
 * VAT, stock and COGS accounts, default determination rules, fiscal year 2027, clock at
 * 2027-06-15), real parties, items, tax codes and warehouses, stock receipts through StockService
 * and an API client.
 */
final class SalesKit
{
    public const string TODAY = '2027-06-15';

    public const array ALL = [
        'sales.quotes.view', 'sales.quotes.create', 'sales.quotes.update', 'sales.quotes.delete',
        'sales.orders.view', 'sales.orders.create', 'sales.orders.update', 'sales.orders.delete', 'sales.orders.approve',
        'sales.deliveries.view', 'sales.deliveries.create', 'sales.deliveries.update', 'sales.deliveries.delete', 'sales.deliveries.post', 'sales.deliveries.reverse',
        'sales.invoices.view', 'sales.invoices.create', 'sales.invoices.update', 'sales.invoices.delete', 'sales.invoices.issue', 'sales.invoices.reverse',
        'sales.returns.view', 'sales.returns.create', 'sales.returns.update', 'sales.returns.delete', 'sales.returns.approve', 'sales.returns.receive', 'sales.returns.credit',
    ];

    public static function boot(): void
    {
        Carbon::setTestNow(Books::TODAY);
        config(['accounting.chart_path' => Inv::chart()]);
        CurrencyCatalog::ensure(['TRY', 'USD', 'EUR']);
    }

    public static function company(): string
    {
        return Actors::company();
    }

    /**
     * A company with a default warehouse MAIN, unit, VAT 20% code, a stock item WIDGET (10 on hand
     * at cost 50), a service item SETUP, a customer and a user with every sales permission.
     *
     * @return object{company: string, wh: Warehouse, unit: Unit, vat: TaxCode, item: Item, service: Item, party: Party, user: User}
     */
    public static function world(bool $stock = true): object
    {
        self::boot();
        $company = self::company();
        $wh = self::warehouse($company);
        $unit = self::unit($company);
        $vat = self::taxCode($company);
        $item = self::item($company, ['code' => 'WIDGET', 'name' => 'Widget', 'default_tax_code_id' => $vat->id], $unit);
        $service = self::item($company, ['code' => 'SETUP', 'name' => 'Setup', 'type' => 'service', 'default_tax_code_id' => $vat->id], $unit);
        $party = self::party($company, ['name' => 'Acme']);
        $user = self::user();

        if ($stock) {
            self::receive($company, $wh->id, $item->id, '10', '50');
        }

        return (object) compact('company', 'wh', 'unit', 'vat', 'item', 'service', 'party', 'user');
    }

    /**
     * A confirmed order through the API (lines: [item id, qty, price]).
     *
     * @param  list<array{0: string, 1: string, 2: string}>  $lines
     * @return array<string, mixed>
     */
    public static function confirmedOrder(object $w, array $lines, array $header = []): array
    {
        $order = self::post($w->user, $w->company, 'sales-orders', [
            'party_id' => $w->party->id, 'document_date' => '2027-06-10', ...$header,
            'lines' => array_map(static fn (array $l): array => ['item_id' => $l[0], 'quantity' => $l[1], 'unit_price' => $l[2]], $lines),
        ])->assertCreated()->json('data');

        return self::post($w->user, $w->company, "sales-orders/{$order['id']}/confirm")->assertOk()->json('data');
    }

    /**
     * Delivers (and posts) quantities of order lines: [order line id => qty].
     *
     * @param  array<string, string>  $quantities
     * @return array<string, mixed>
     */
    public static function deliver(object $w, string $orderId, array $quantities): array
    {
        $lines = [];

        foreach ($quantities as $id => $qty) {
            $lines[] = ['order_line_id' => $id, 'quantity' => $qty];
        }

        $delivery = self::post($w->user, $w->company, "sales-orders/{$orderId}/deliveries", ['document_date' => '2027-06-12', 'lines' => $lines])
            ->assertCreated()->json('data');

        return self::post($w->user, $w->company, "sales-deliveries/{$delivery['id']}/post")->assertOk()->json('data');
    }

    /**
     * Invoices a posted delivery completely and issues the invoice.
     *
     * @return array<string, mixed>
     */
    public static function invoiceDelivery(object $w, string $deliveryId): array
    {
        $invoice = self::post($w->user, $w->company, "sales-deliveries/{$deliveryId}/invoice", ['document_date' => '2027-06-13'])
            ->assertCreated()->json('data');

        return self::post($w->user, $w->company, "sales-invoices/{$invoice['id']}/issue")->assertOk()->json('data');
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

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function party(string $company, array $attributes = []): Party
    {
        return self::in($company, fn (): Party => Party::factory()->create($attributes));
    }

    public static function warehouse(string $company, string $code = 'MAIN', bool $default = true, string $negative = 'block'): Warehouse
    {
        return Inv::warehouse($company, $code, $negative, $default);
    }

    public static function unit(string $company, string $code = 'PCS'): Unit
    {
        return Inv::unit($company, $code);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function item(string $company, array $attributes = [], ?Unit $unit = null): Item
    {
        return Inv::item($company, $attributes, $unit);
    }

    public static function taxCode(string $company, string $rate = '20.0000', string $from = '2023-07-10', ?string $to = null): TaxCode
    {
        return self::in($company, fn (): TaxCode => TaxCode::factory()->create([
            'company_id' => $company, 'rate' => $rate, 'effective_from' => $from, 'effective_to' => $to,
        ]));
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function priceList(string $company, array $attributes = []): PriceList
    {
        return Catalog::priceList($company, $attributes);
    }

    public static function receive(string $company, string $warehouse, string $item, string $qty, string $cost, array $extra = []): void
    {
        Inv::receive($company, $warehouse, $item, $qty, $cost, $extra, '2027-06-01');
    }

    public static function setting(string $company, string $key, mixed $value): void
    {
        DB::table('settings')->updateOrInsert(
            ['company_id' => $company, 'key' => $key],
            ['id' => (string) Str::uuid7(), 'value' => json_encode($value), 'created_at' => now(), 'updated_at' => now()],
        );
        SettingsService::forget($company);
    }

    /**
     * @param  list<string>  $extra
     */
    public static function user(array $extra = []): User
    {
        return Actors::user([...self::ALL, ...$extra]);
    }

    public static function as(User $user, string $company): mixed
    {
        Identity::fresh();

        return test()->actingAs($user, 'web')->withHeaders(['X-Company-Id' => $company, 'Accept' => 'application/json']);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return TestResponse<Response>
     */
    public static function post(User $user, string $company, string $uri, array $data = [], ?string $key = null): TestResponse
    {
        return self::as($user, $company)->postJson('/api/v1/'.$uri, $data, ['Idempotency-Key' => $key ?? (string) Str::uuid7()]);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return TestResponse<Response>
     */
    public static function patch(User $user, string $company, string $uri, array $data = []): TestResponse
    {
        return self::as($user, $company)->patchJson('/api/v1/'.$uri, $data);
    }

    /**
     * @return TestResponse<Response>
     */
    public static function get(User $user, string $company, string $uri): TestResponse
    {
        return self::as($user, $company)->getJson('/api/v1/'.$uri);
    }

    /** Debit-positive balance of an account code. */
    public static function balance(string $company, string $code): string
    {
        return Books::balance($company, $code);
    }

    public static function dec(mixed $value): BigDecimal
    {
        return BigDecimal::of(is_string($value) || is_int($value) ? $value : '0');
    }

    /**
     * Sum of debits and credits of a journal entry per account code.
     *
     * @return array<string, array{debit: string, credit: string}>
     */
    public static function journal(string $entryId): array
    {
        $rows = DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')->where('l.entry_id', $entryId)
            ->groupBy('a.code')->orderBy('a.code')->selectRaw('a.code, sum(l.debit) AS debit, sum(l.credit) AS credit')->get();
        $out = [];

        foreach ($rows as $row) {
            $out[(string) $row->code] = [
                'debit' => (string) BigDecimal::of((string) $row->debit)->toScale(2),
                'credit' => (string) BigDecimal::of((string) $row->credit)->toScale(2),
            ];
        }

        return $out;
    }
}
