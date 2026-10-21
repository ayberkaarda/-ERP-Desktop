<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Services\ChartSeeder;
use App\Modules\Accounting\Services\DeterminationRules;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Inventory\Services\InventoryRules;
use App\Modules\Parties\Models\Party;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Services\InvoiceService;
use App\Modules\Sales\Services\OrderService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Tests\Support\Companies;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sales\SalesKit;

/*
 * Committed data and two connections for the interleavings of review findings 2 and 7.
 */

beforeEach(function (): void {
    if (! Schema::hasTable('sales_orders')) {
        Artisan::call('migrate', ['--force' => true]);
    }

    // Currencies are global rows: remember which existed so the ones added here are removed again.
    $this->currencies = DB::table('currencies')->pluck('code')->all();
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
    Inv::warehouse($this->company, 'MAIN', 'block', true);
    $vat = SalesKit::taxCode($this->company);
    $this->service = Inv::item($this->company, ['type' => 'service', 'default_tax_code_id' => $vat->id]);
    $this->party = Party::factory()->create();
    $orders = app(OrderService::class);
    $make = function () use ($orders) {
        $order = $orders->create(['party_id' => $this->party->id], [['item_id' => $this->service->id, 'quantity' => '1', 'unit_price' => '100']], null, false);

        return $orders->confirm($order, null, null, false, null)[0];
    };
    $this->orderA = $make();
    $this->orderB = $make();
    $this->invoice = app(InvoiceService::class)->create(['party_id' => $this->party->id],
        [['order_line_id' => $this->orderA->lines()->firstOrFail()->id, 'quantity' => '1']], null, false);
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
    $this->a->table('currencies')->whereNotIn('code', $this->currencies)->delete();
    app(CompanyContext::class)->clear();
    DB::purge('pgsql_second');
    Carbon::setTestNow();
});

it('issues against the sources the invoice has once it is locked (finding 2)', function (): void {
    $lineB = $this->orderB->lines()->firstOrFail()->id;
    $fired = false;

    // Right after issue locked the order it read first, another session re-points the line to order B.
    Event::listen(QueryExecuted::class, function (QueryExecuted $q) use (&$fired, $lineB): void {
        if (! $fired && $q->connectionName === 'pgsql' && str_contains($q->sql, '"sales_orders"') && str_contains($q->sql, 'for update')) {
            $fired = true;
            $this->b->table('sales_invoice_lines')->where('document_id', $this->invoice->id)->update(['order_line_id' => $lineB, 'source_line_id' => $lineB]);
        }
    });

    app(InvoiceService::class)->issue(SalesInvoice::query()->findOrFail($this->invoice->id), null, null, false, null);

    expect($fired)->toBeTrue()
        ->and((string) DB::table('sales_order_lines')->where('id', $lineB)->value('invoiced_quantity'))->toBe('1.000000')
        ->and(DB::table('sales_orders')->where('id', $this->orderB->id)->value('status'))->toBe('invoiced')
        ->and((string) DB::table('sales_order_lines')->where('document_id', $this->orderA->id)->value('invoiced_quantity'))->toBe('0.000000');
});

it('makes line edits wait for an issue in progress and then refuses them (finding 7)', function (): void {
    $this->a->beginTransaction();
    app(InvoiceService::class)->issue(SalesInvoice::query()->findOrFail($this->invoice->id), null, null, false, null);

    $this->b->statement("SET lock_timeout = '300ms'");
    $waited = null;
    try {
        $this->b->table('sales_invoice_lines')->where('document_id', $this->invoice->id)->update(['description' => 'changed']);
    } catch (QueryException $e) {
        $waited = $e->errorInfo[0] ?? null;
    }
    expect($waited)->toBe('55P03');

    $this->a->commit();
    $refused = null;
    try {
        $this->b->table('sales_invoice_lines')->where('document_id', $this->invoice->id)->update(['description' => 'changed']);
    } catch (QueryException $e) {
        $refused = $e->errorInfo[0] ?? null;
    }
    expect($refused)->toBe('KS002');
});
