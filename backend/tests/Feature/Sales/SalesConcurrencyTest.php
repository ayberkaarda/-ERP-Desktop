<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Services\ChartSeeder;
use App\Modules\Accounting\Services\DeterminationRules;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Inventory\Services\InventoryRules;
use App\Modules\Parties\Models\Party;
use App\Modules\Sales\Exceptions\CreditLimitExceeded;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Services\DeliveryService;
use App\Modules\Sales\Services\InvoiceService;
use App\Modules\Sales\Services\OrderService;
use App\Modules\Sales\Services\ReturnService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Tests\Support\Companies;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

/*
 * Committed data and two real connections (no wrapping test transaction): a conversion holds the
 * row lock of its source (order, delivery, invoice) and a confirmation the party's credit lock
 * until it commits, so a second one waits, and after the first commits it sees the reduced
 * remaining quantity (or the higher exposure). Everything is removed in afterEach.
 */

beforeEach(function (): void {
    if (! Schema::hasTable('sales_orders')) {
        Artisan::call('migrate', ['--force' => true]);
    }

    SalesKit::boot();
    config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);
    $this->a = DB::connection('pgsql');
    $this->b = DB::connection('pgsql_second');
    $this->company = Companies::make();
    app(CompanyContext::class)->set($this->company);
    app(ChartSeeder::class)->seed(ExpenseScheme::A);
    app(FiscalCalendar::class)->create(['code' => '2027', 'start_date' => '2027-01-01', 'end_date' => '2027-12-31']);
    app(DeterminationRules::class)->ensureDefaults(ExpenseScheme::A);
    app(InventoryRules::class)->ensureDefaults($this->company);
    $this->wh = Inv::warehouse($this->company, 'MAIN', 'block', true);
    $this->vat = SalesKit::taxCode($this->company);
    $this->item = Inv::item($this->company, ['default_tax_code_id' => $this->vat->id]);
    $this->party = Party::factory()->create(['risk_limit' => '1000', 'risk_currency_code' => 'TRY']);
    Inv::receive($this->company, $this->wh->id, $this->item->id, '20', '10');

    $this->order = app(OrderService::class)->create(['party_id' => $this->party->id, 'document_date' => '2027-06-10'],
        [['item_id' => $this->item->id, 'quantity' => '5', 'unit_price' => '100']], null, false);
    [$this->order] = app(OrderService::class)->confirm($this->order, null, null, false, null);
    $this->line = $this->order->lines()->firstOrFail()->id;
});

afterEach(function (): void {
    DB::setDefaultConnection('pgsql');

    foreach ([$this->a, $this->b] as $connection) {
        while ($connection->transactionLevel() > 0) {
            $connection->rollBack();
        }
        $connection->statement('RESET lock_timeout');
    }

    $this->a->statement('SET session_replication_role = replica');
    foreach ([
        'sales_receivable_applications', 'sales_return_lines', 'sales_returns', 'sales_invoice_lines', 'sales_invoices', 'sales_delivery_lines',
        'sales_deliveries', 'sales_order_lines', 'sales_orders', 'sales_quote_lines', 'sales_quotes',
        'stock_cost_layers', 'stock_movements', 'stock_balances', 'stock_valuations', 'stock_reservations', 'stock_document_lines', 'stock_documents',
        'stock_serials', 'stock_lots', 'stock_warehouse_settings', 'journal_lines', 'account_balances', 'journal_entries', 'account_determination_rules',
        'accounts', 'accounting_periods', 'fiscal_years', 'number_sequences', 'activity_log', 'items', 'units', 'locations', 'warehouses', 'settings',
        'parties', 'tax_codes',
    ] as $table) {
        $this->a->table($table)->where('company_id', $this->company)->delete();
    }
    $this->a->statement('SET session_replication_role = DEFAULT');
    Companies::remove($this->company);
    app(CompanyContext::class)->clear();
    DB::purge('pgsql_second');
    Carbon::setTestNow();
});

/** Runs $fn on the second connection with a short lock timeout. */
function onSecondSales(Closure $fn): mixed
{
    DB::setDefaultConnection('pgsql_second');
    DB::connection('pgsql_second')->statement("SET lock_timeout = '300ms'");

    try {
        return $fn();
    } finally {
        DB::setDefaultConnection('pgsql');
    }
}

function isLockTimeout(Throwable $e): bool
{
    return $e instanceof QueryException && ($e->errorInfo[0] ?? null) === '55P03';
}

it('serializes two deliveries of one order line: the second never exceeds the order', function (): void {
    $deliveries = app(DeliveryService::class);
    $this->a->beginTransaction();
    $deliveries->createFromOrder($this->order, [], [['order_line_id' => $this->line, 'quantity' => '3']], null);

    $blocked = null;
    try {
        onSecondSales(fn () => $deliveries->createFromOrder(SalesOrder::query()->findOrFail($this->order->id), [], [['order_line_id' => $this->line, 'quantity' => '3']], null));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect($blocked)->not->toBeNull()->and(isLockTimeout($blocked))->toBeTrue();

    $this->a->commit();
    $refused = null;
    try {
        onSecondSales(fn () => $deliveries->createFromOrder(SalesOrder::query()->findOrFail($this->order->id), [], [['order_line_id' => $this->line, 'quantity' => '3']], null));
    } catch (ValidationException $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull();

    $two = onSecondSales(fn () => $deliveries->createFromOrder(SalesOrder::query()->findOrFail($this->order->id), [], [['order_line_id' => $this->line, 'quantity' => '2']], null));
    expect($two->id)->not->toBeEmpty()
        ->and((string) DB::table('sales_delivery_lines')->where('order_line_id', $this->line)->selectRaw('sum(quantity) AS s')->value('s'))->toBe('5.000000');
});

it('serializes two invoices of one delivery: the delivered quantity is invoiced once', function (): void {
    $deliveries = app(DeliveryService::class);
    $delivery = $deliveries->createFromOrder($this->order, [], [['order_line_id' => $this->line, 'quantity' => '4']], null);
    [$delivery] = $deliveries->post($delivery, null, null);
    $invoices = app(InvoiceService::class);

    $this->a->beginTransaction();
    $invoices->createFromDelivery($delivery, [], null, null);
    $blocked = null;
    try {
        onSecondSales(fn () => $invoices->createFromDelivery(SalesDelivery::query()->findOrFail($delivery->id), [], null, null));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect(isLockTimeout($blocked))->toBeTrue();
    $this->a->commit();

    $refused = null;
    try {
        onSecondSales(fn () => $invoices->createFromDelivery(SalesDelivery::query()->findOrFail($delivery->id), [], null, null));
    } catch (ValidationException $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull()
        ->and(DB::table('sales_invoices')->where('company_id', $this->company)->count())->toBe(1);
});

it('serializes credit checks of one customer: the second confirmation sees the first as exposure', function (): void {
    SalesKit::setting($this->company, 'sales.credit_check_mode', 'block');
    $orders = app(OrderService::class);
    // Limit 1000, open order 600: two more orders of 360 each would only fit one at a time.
    $first = $orders->create(['party_id' => $this->party->id], [['item_id' => $this->item->id, 'quantity' => '3', 'unit_price' => '100']], null, false);
    $second = $orders->create(['party_id' => $this->party->id], [['item_id' => $this->item->id, 'quantity' => '3', 'unit_price' => '100']], null, false);

    $this->a->beginTransaction();
    $orders->confirm($first, null, null, false, null);
    $blocked = null;
    try {
        onSecondSales(fn () => $orders->confirm(SalesOrder::query()->findOrFail($second->id), null, null, false, null));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect(isLockTimeout($blocked))->toBeTrue();
    $this->a->commit();

    $refused = null;
    try {
        onSecondSales(fn () => $orders->confirm(SalesOrder::query()->findOrFail($second->id), null, null, false, null));
    } catch (CreditLimitExceeded $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull()
        ->and($refused->check->exposure)->toBe('960.00')
        ->and(DB::table('sales_orders')->where('id', $second->id)->value('status'))->toBe('draft');
});

it('serializes two returns of one invoice line', function (): void {
    $deliveries = app(DeliveryService::class);
    $delivery = $deliveries->createFromOrder($this->order, [], [['order_line_id' => $this->line, 'quantity' => '2']], null);
    [$delivery] = $deliveries->post($delivery, null, null);
    $invoice = app(InvoiceService::class)->createFromDelivery($delivery, [], null, null);
    [$invoice] = app(InvoiceService::class)->issue($invoice, null, null, false, null);
    $invoiceLine = $invoice->lines()->firstOrFail()->id;
    $returns = app(ReturnService::class);

    $this->a->beginTransaction();
    $returns->createFromInvoice($invoice, [], [['invoice_line_id' => $invoiceLine, 'quantity' => '2']], null);
    $blocked = null;
    try {
        onSecondSales(fn () => $returns->createFromInvoice(SalesInvoice::query()->findOrFail($invoice->id), [], [['invoice_line_id' => $invoiceLine, 'quantity' => '1']], null));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect(isLockTimeout($blocked))->toBeTrue();
    $this->a->commit();

    $refused = null;
    try {
        onSecondSales(fn () => $returns->createFromInvoice(SalesInvoice::query()->findOrFail($invoice->id), [], [['invoice_line_id' => $invoiceLine, 'quantity' => '1']], null));
    } catch (ValidationException $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull();
});

