<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Services\ChartSeeder;
use App\Modules\Accounting\Services\DeterminationRules;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Inventory\Services\InventoryRules;
use App\Modules\Parties\Models\Party;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Services\InvoiceService;
use App\Modules\Purchasing\Services\OrderService;
use App\Modules\Purchasing\Services\ReceiptService;
use App\Modules\Purchasing\Services\ReturnService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Tests\Support\Companies;
use Tests\Support\Inventory\Inv;
use Tests\Support\Purchasing\PurchKit;

/*
 * Committed data and two real connections (no wrapping test transaction): a conversion holds the
 * row lock of its source (order, receipt, invoice) and a supplier invoice number check the
 * supplier's advisory lock until it commits, so a second one waits, and after the first commits it
 * sees the reduced remaining quantity (or the taken number). Everything is removed in afterEach.
 */

beforeEach(function (): void {
    if (! Schema::hasTable('purchase_orders')) {
        Artisan::call('migrate', ['--force' => true]);
    }

    $this->currencies = DB::table('currencies')->pluck('code')->all();
    PurchKit::boot();
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
    $this->vat = PurchKit::taxCode($this->company);
    $this->item = Inv::item($this->company, ['default_tax_code_id' => $this->vat->id]);
    $this->party = Party::factory()->supplier()->create();

    $orders = app(OrderService::class);
    $this->order = $orders->create(['party_id' => $this->party->id, 'document_date' => '2027-06-10'],
        [['item_id' => $this->item->id, 'quantity' => '5', 'unit_price' => '100']], null, false);
    $this->order = $orders->submit($this->order, null, null);
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
        'purchase_payable_applications', 'purchase_return_lines', 'purchase_returns', 'purchase_invoice_lines', 'purchase_invoices',
        'purchase_receipt_lines', 'purchase_receipts', 'purchase_order_lines', 'purchase_orders', 'purchase_rfq_quotes', 'purchase_rfq_suppliers',
        'purchase_rfq_lines', 'purchase_rfqs', 'purchase_request_lines', 'purchase_requests',
        'stock_cost_layers', 'stock_movements', 'stock_balances', 'stock_valuations', 'stock_reservations', 'stock_document_lines', 'stock_documents',
        'stock_serials', 'stock_lots', 'stock_warehouse_settings', 'journal_lines', 'account_balances', 'journal_entries', 'account_determination_rules',
        'accounts', 'accounting_periods', 'fiscal_years', 'number_sequences', 'activity_log', 'items', 'units', 'locations', 'warehouses', 'settings',
        'parties', 'tax_codes',
    ] as $table) {
        $this->a->table($table)->where('company_id', $this->company)->delete();
    }
    $this->a->statement('SET session_replication_role = DEFAULT');
    Companies::remove($this->company);
    $this->a->table('currencies')->whereNotIn('code', $this->currencies)->delete();
    app(CompanyContext::class)->clear();
    DB::purge('pgsql_second');
    Carbon::setTestNow();
});

/** Runs $fn on the second connection with a short lock timeout. */
function onSecondPurch(Closure $fn): mixed
{
    DB::setDefaultConnection('pgsql_second');
    DB::connection('pgsql_second')->statement("SET lock_timeout = '300ms'");

    try {
        return $fn();
    } finally {
        DB::setDefaultConnection('pgsql');
    }
}

function purchLockTimeout(?Throwable $e): bool
{
    return $e instanceof QueryException && ($e->errorInfo[0] ?? null) === '55P03';
}

it('serializes two receipts of one order line: the second never exceeds the order', function (): void {
    $receipts = app(ReceiptService::class);
    $this->a->beginTransaction();
    $receipts->createFromOrder($this->order, [], [['order_line_id' => $this->line, 'quantity' => '3']], null);

    $blocked = null;
    try {
        onSecondPurch(fn () => $receipts->createFromOrder(PurchaseOrder::query()->findOrFail($this->order->id), [], [['order_line_id' => $this->line, 'quantity' => '3']], null));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect(purchLockTimeout($blocked))->toBeTrue();
    $this->a->commit();

    $refused = null;
    try {
        onSecondPurch(fn () => $receipts->createFromOrder(PurchaseOrder::query()->findOrFail($this->order->id), [], [['order_line_id' => $this->line, 'quantity' => '3']], null));
    } catch (ValidationException $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull();

    $two = onSecondPurch(fn () => $receipts->createFromOrder(PurchaseOrder::query()->findOrFail($this->order->id), [], [['order_line_id' => $this->line, 'quantity' => '2']], null));
    expect($two->id)->not->toBeEmpty()
        ->and((string) DB::table('purchase_receipt_lines')->where('order_line_id', $this->line)->selectRaw('sum(quantity) AS s')->value('s'))->toBe('5.000000');
});

it('serializes two invoices of one receipt: the received quantity is invoiced once', function (): void {
    $receipts = app(ReceiptService::class);
    $receipt = $receipts->createFromOrder($this->order, [], [['order_line_id' => $this->line, 'quantity' => '4']], null);
    [$receipt] = $receipts->post($receipt, null, null);
    $invoices = app(InvoiceService::class);

    $this->a->beginTransaction();
    $invoices->createFromReceipt($receipt, ['supplier_invoice_no' => 'C-1'], null, null, false);
    $blocked = null;
    try {
        onSecondPurch(fn () => $invoices->createFromReceipt(PurchaseReceipt::query()->findOrFail($receipt->id), ['supplier_invoice_no' => 'C-2'], null, null, false));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect(purchLockTimeout($blocked))->toBeTrue();
    $this->a->commit();

    $refused = null;
    try {
        onSecondPurch(fn () => $invoices->createFromReceipt(PurchaseReceipt::query()->findOrFail($receipt->id), ['supplier_invoice_no' => 'C-2'], null, null, false));
    } catch (ValidationException $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull()
        ->and(DB::table('purchase_invoices')->where('company_id', $this->company)->count())->toBe(1);
});

it('serializes two invoices with one supplier invoice number', function (): void {
    $invoices = app(InvoiceService::class);
    $line = [['item_id' => $this->item->id, 'quantity' => '1', 'unit_price' => '1']];
    $body = ['party_id' => $this->party->id, 'supplier_invoice_no' => 'SAME-1', 'receive_on_invoice' => true];

    $this->a->beginTransaction();
    $invoices->create($body, $line, null, false);
    $blocked = null;
    try {
        onSecondPurch(fn () => $invoices->create($body, $line, null, false));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect(purchLockTimeout($blocked))->toBeTrue();
    $this->a->commit();

    $refused = null;
    try {
        onSecondPurch(fn () => $invoices->create($body, $line, null, false));
    } catch (ValidationException $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull()->and(array_keys($refused->errors()))->toBe(['supplier_invoice_no']);
});

it('serializes two returns of one invoice line', function (): void {
    $receipts = app(ReceiptService::class);
    $receipt = $receipts->createFromOrder($this->order, [], [['order_line_id' => $this->line, 'quantity' => '2']], null);
    [$receipt] = $receipts->post($receipt, null, null);
    $invoice = app(InvoiceService::class)->createFromReceipt($receipt, ['supplier_invoice_no' => 'R-1'], null, null, false);
    [$invoice] = app(InvoiceService::class)->book($invoice, null, null, false, null);
    $invoiceLine = $invoice->lines()->firstOrFail()->id;
    $returns = app(ReturnService::class);

    $this->a->beginTransaction();
    $returns->createFromInvoice($invoice, [], [['invoice_line_id' => $invoiceLine, 'quantity' => '2']], null);
    $blocked = null;
    try {
        onSecondPurch(fn () => $returns->createFromInvoice(PurchaseInvoice::query()->findOrFail($invoice->id), [], [['invoice_line_id' => $invoiceLine, 'quantity' => '1']], null));
    } catch (Throwable $e) {
        $blocked = $e;
    }
    expect(purchLockTimeout($blocked))->toBeTrue();
    $this->a->commit();

    $refused = null;
    try {
        onSecondPurch(fn () => $returns->createFromInvoice(PurchaseInvoice::query()->findOrFail($invoice->id), [], [['invoice_line_id' => $invoiceLine, 'quantity' => '1']], null));
    } catch (ValidationException $e) {
        $refused = $e;
    }
    expect($refused)->not->toBeNull();
});
