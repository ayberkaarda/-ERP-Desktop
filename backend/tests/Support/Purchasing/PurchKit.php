<?php

declare(strict_types=1);

namespace Tests\Support\Purchasing;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Parties\Models\Party;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Services\CurrencyCatalog;
use App\Modules\Settings\Services\SettingsService;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Closure;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Inventory\Inv;

/**
 * Purchasing fixtures: a company bootstrapped like a real one (fixture chart with payable, VAT,
 * withholding, stock, goods received not invoiced (381) and price variance (621) accounts, default
 * determination rules, fiscal year 2027, clock at 2027-06-15), real suppliers, items, tax codes
 * (VAT 20% and a 5/10 withholding) and warehouses, and an API client.
 */
final class PurchKit
{
    public const array ALL = [
        'purchasing.requests.view', 'purchasing.requests.create', 'purchasing.requests.update', 'purchasing.requests.delete',
        'purchasing.rfqs.view', 'purchasing.rfqs.create', 'purchasing.rfqs.update', 'purchasing.rfqs.delete', 'purchasing.rfqs.award',
        'purchasing.orders.view', 'purchasing.orders.create', 'purchasing.orders.update', 'purchasing.orders.delete', 'purchasing.orders.approve',
        'purchasing.receipts.view', 'purchasing.receipts.create', 'purchasing.receipts.update', 'purchasing.receipts.delete', 'purchasing.receipts.post',
        'purchasing.receipts.reverse',
        'purchasing.invoices.view', 'purchasing.invoices.create', 'purchasing.invoices.update', 'purchasing.invoices.delete', 'purchasing.invoices.book',
        'purchasing.invoices.reverse',
        'purchasing.returns.view', 'purchasing.returns.create', 'purchasing.returns.update', 'purchasing.returns.delete', 'purchasing.returns.approve',
        'purchasing.returns.ship', 'purchasing.returns.debit',
    ];

    public static function chart(): string
    {
        return dirname(__DIR__, 2).'/Fixtures/Purchasing/chart.json';
    }

    public static function boot(): void
    {
        Carbon::setTestNow(Books::TODAY);
        config(['accounting.chart_path' => self::chart()]);
        CurrencyCatalog::ensure(['TRY', 'USD', 'EUR']);
    }

    public static function company(): string
    {
        return Actors::company();
    }

    /**
     * A company with a default warehouse MAIN, unit, VAT 20% code, withholding 5/10 code, a stock
     * item WIDGET, a service item SETUP, a supplier and a user with every purchasing permission.
     *
     * @return object{company: string, wh: Warehouse, unit: Unit, vat: TaxCode, withholding: TaxCode, item: Item, service: Item, party: Party, user: User}
     */
    public static function world(): object
    {
        self::boot();
        $company = self::company();
        $wh = Inv::warehouse($company, 'MAIN', 'block', true);
        $unit = Inv::unit($company);
        $vat = self::taxCode($company);
        $withholding = self::withholdingCode($company);
        $item = Inv::item($company, ['code' => 'WIDGET', 'name' => 'Widget', 'default_tax_code_id' => $vat->id], $unit);
        $service = Inv::item($company, ['code' => 'SETUP', 'name' => 'Setup', 'type' => 'service', 'default_tax_code_id' => $vat->id], $unit);
        $party = self::supplier($company, ['name' => 'Supplier A']);
        $user = self::user();

        return (object) compact('company', 'wh', 'unit', 'vat', 'withholding', 'item', 'service', 'party', 'user');
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
    public static function supplier(string $company, array $attributes = []): Party
    {
        return self::in($company, fn (): Party => Party::factory()->supplier()->create($attributes));
    }

    public static function taxCode(string $company, string $rate = '20.0000'): TaxCode
    {
        return self::in($company, fn (): TaxCode => TaxCode::factory()->create([
            'company_id' => $company, 'rate' => $rate, 'effective_from' => '2023-07-10',
        ]));
    }

    public static function withholdingCode(string $company, int $numerator = 5, int $denominator = 10): TaxCode
    {
        return self::in($company, fn (): TaxCode => TaxCode::factory()->create([
            'company_id' => $company, 'type' => 'withholding', 'rate' => null, 'numerator' => $numerator, 'denominator' => $denominator,
            'effective_from' => '2023-07-10',
        ]));
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

    /**
     * An approved order through the API (lines: [item id, qty, price]).
     *
     * @param  list<array{0: string, 1: string, 2: string}>  $lines
     * @param  array<string, mixed>  $header
     * @return array<string, mixed>
     */
    public static function approvedOrder(object $w, array $lines, array $header = []): array
    {
        $order = self::post($w->user, $w->company, 'purchase-orders', [
            'party_id' => $w->party->id, 'document_date' => '2027-06-10', ...$header,
            'lines' => array_map(static fn (array $l): array => ['item_id' => $l[0], 'quantity' => $l[1], 'unit_price' => $l[2]], $lines),
        ])->assertCreated()->json('data');

        return self::post($w->user, $w->company, "purchase-orders/{$order['id']}/submit")->assertOk()->json('data');
    }

    /**
     * Receives (and posts) quantities of order lines: [order line id => qty].
     *
     * @param  array<string, string>  $quantities
     * @return array<string, mixed>
     */
    public static function receive(object $w, string $orderId, array $quantities, string $date = '2027-06-12'): array
    {
        $lines = [];

        foreach ($quantities as $id => $qty) {
            $lines[] = ['order_line_id' => $id, 'quantity' => $qty];
        }

        $receipt = self::post($w->user, $w->company, "purchase-orders/{$orderId}/receipts", ['document_date' => $date, 'lines' => $lines])
            ->assertCreated()->json('data');

        return self::post($w->user, $w->company, "purchase-receipts/{$receipt['id']}/post")->assertOk()->json('data');
    }

    /**
     * Invoices a posted receipt completely and books the invoice.
     *
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    public static function invoiceReceipt(object $w, string $receiptId, ?string $supplierNo = null, array $extra = []): array
    {
        $invoice = self::post($w->user, $w->company, "purchase-receipts/{$receiptId}/invoice", [
            'document_date' => '2027-06-13', 'supplier_invoice_no' => $supplierNo ?? 'SUP-'.Str::upper(Str::random(6)), ...$extra,
        ])->assertCreated()->json('data');

        return self::post($w->user, $w->company, "purchase-invoices/{$invoice['id']}/book")->assertOk()->json('data');
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
                'debit' => self::amount((string) $row->debit),
                'credit' => self::amount((string) $row->credit),
            ];
        }

        return $out;
    }

    /** Totals of a journal entry: [debit, credit] scale 2. */
    public static function entryTotals(string $entryId): array
    {
        $row = DB::table('journal_lines')->where('entry_id', $entryId)->selectRaw('coalesce(sum(debit), 0) AS d, coalesce(sum(credit), 0) AS c')->first();

        return [self::amount((string) ($row->d ?? '0')), self::amount((string) ($row->c ?? '0'))];
    }

    /** An amount at scale 2, or 4 when it has more decimals (stock and accrual amounts). */
    public static function amount(string $value): string
    {
        $value = BigDecimal::of($value);
        $cents = $value->toScale(2, RoundingMode::Down);

        return (string) ($cents->isEqualTo($value) ? $cents : $value->toScale(4));
    }
}
