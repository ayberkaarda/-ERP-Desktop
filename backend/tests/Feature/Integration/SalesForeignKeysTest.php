<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

const SALES_FK_MIGRATION = 'database/migrations/2027_03_01_900100_add_sales_foreign_keys.php';

beforeEach(function (): void {
    $this->w = SalesKit::world();
});

/** Foreign keys of the schema as "table.column" => "referenced table:delete rule:update rule". */
function salesForeignKeys(): array
{
    return collect(DB::select(<<<'SQL'
        SELECT tc.table_name AS tab, kcu.column_name AS col, ccu.table_name AS ref, rc.delete_rule AS del, rc.update_rule AS upd
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
        SQL))->mapWithKeys(fn (object $k): array => ["{$k->tab}.{$k->col}" => "{$k->ref}:{$k->del}:{$k->upd}"])->all();
}

/** A draft quote with one raw line (drafts are mutable). */
function salesDraftWith(object $w, array $line = [], array $doc = []): string
{
    $id = (string) Str::uuid7();
    DB::table('sales_quotes')->insert([
        'id' => $id, 'company_id' => $w->company, 'status' => 'draft', 'document_date' => '2027-06-10', 'party_id' => $w->party->id,
        'party_name' => 'Acme', 'currency_code' => 'TRY', 'version' => 1, 'created_at' => now(), 'updated_at' => now(), ...$doc,
    ]);
    DB::table('sales_quote_lines')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $w->company, 'document_id' => $id, 'line_no' => 1, 'item_id' => $w->item->id,
        'item_type' => 'stock', 'unit_id' => $w->unit->id, 'quantity' => '1', 'base_quantity' => '1', ...$line,
    ]);

    return $id;
}

it('constrains every sales table to companies and its cross-module references with RESTRICT', function (): void {
    $keys = salesForeignKeys();

    foreach (MasterDataIntegrity::SALES_COMPANY_TABLES as $table) {
        expect($keys["{$table}.company_id"] ?? null)->toBe('companies:RESTRICT:RESTRICT', $table);
    }

    foreach (MasterDataIntegrity::SALES_CROSS_MODULE as [$table, $column, $references]) {
        expect($keys["{$table}.{$column}"] ?? null)->toBe("{$references}:RESTRICT:RESTRICT", "{$table}.{$column}");
    }

    // Same-module keys of the Sales migration stay; source links are free.
    expect($keys['sales_quote_lines.document_id'])->toBe('sales_quotes:CASCADE:NO ACTION')
        ->and($keys['sales_returns.invoice_id'])->toBe('sales_invoices:RESTRICT:NO ACTION')
        ->and(array_key_exists('sales_orders.source_id', $keys))->toBeFalse()
        ->and(array_key_exists('sales_invoice_lines.source_line_id', $keys))->toBeFalse();
});

it('rejects sales rows pointing at records that do not exist', function (string $where, string $column): void {
    $missing = '0190a1b2-0000-7000-8000-0000000000aa';

    expect(fn () => DB::transaction(fn () => $where === 'line'
        ? salesDraftWith($this->w, [$column => $missing])
        : salesDraftWith($this->w, [], [$column => $missing])))
        ->toThrow(QueryException::class, ($where === 'line' ? 'sales_quote_lines_' : 'sales_quotes_').$column.'_foreign');
})->with([
    'party' => ['document', 'party_id'],
    'warehouse' => ['document', 'warehouse_id'],
    'payment term' => ['document', 'payment_term_id'],
    'created by' => ['document', 'created_by'],
    'item' => ['line', 'item_id'],
    'unit' => ['line', 'unit_id'],
    'tax code' => ['line', 'tax_code_id'],
]);

it('rejects an unknown currency code on a sales document', function (): void {
    expect(fn () => DB::transaction(fn () => salesDraftWith($this->w, [], ['currency_code' => 'XXX'])))
        ->toThrow(QueryException::class, 'sales_quotes_currency_code_foreign');
});

it('links issued invoices and posted deliveries to journal entries and stock documents through validated keys', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '2', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '2']);
    $invoice = SalesKit::invoiceDelivery($this->w, $delivery['id']);

    expect($delivery['stock_document_id'])->not->toBeNull()
        ->and($invoice['journal_entry_id'])->not->toBeNull();

    // The party, the item and the journal entry the documents carry cannot be hard deleted.
    expect(fn () => DB::transaction(fn () => DB::table('parties')->where('id', $this->w->party->id)->delete()))
        ->toThrow(QueryException::class, '_party_id_foreign');
    expect(fn () => DB::transaction(fn () => DB::table('sales_invoices')->where('id', $invoice['id'])->update(['journal_entry_id' => (string) Str::uuid7()])))
        ->toThrow(QueryException::class);

    foreach (['sales_invoices_journal_entry_id_foreign', 'sales_deliveries_stock_document_id_foreign', 'sales_order_lines_reservation_id_foreign'] as $name) {
        expect(DB::selectOne('SELECT convalidated FROM pg_constraint WHERE conname = ?', [$name])?->convalidated)->toBeTrue($name);
    }
});

it('refuses to add the keys over orphan sales rows with counts and validates them once fixed', function (): void {
    /** @var Migration $migration */
    $migration = require base_path(SALES_FK_MIGRATION);
    $migration->down();
    expect(array_key_exists('sales_quote_lines.item_id', salesForeignKeys()))->toBeFalse();

    $doc = salesDraftWith($this->w, ['item_id' => (string) Str::uuid7()]);

    try {
        $migration->up();
        $this->fail('The migration must refuse orphan rows.');
    } catch (RuntimeException $e) {
        expect($e->getMessage())->toContain('sales_quote_lines.item_id: 1')->toContain('Sales rows are never changed automatically');
    }
    expect(array_key_exists('sales_quote_lines.item_id', salesForeignKeys()))->toBeFalse();

    DB::table('sales_quotes')->where('id', $doc)->delete();
    $migration->up();

    expect(DB::selectOne("SELECT convalidated FROM pg_constraint WHERE conname = 'sales_quote_lines_item_id_foreign'")?->convalidated)->toBeTrue()
        ->and(salesForeignKeys()['sales_invoices.company_id'])->toBe('companies:RESTRICT:RESTRICT');
});

it('reports sales documents whose party belongs to another company in the tenancy audit', function (): void {
    $other = SalesKit::company();
    $foreign = SalesKit::party($other, ['name' => 'Foreign']);
    salesDraftWith($this->w, [], ['party_id' => $foreign->id]);

    expect((new MasterDataIntegrity(DB::connection()))->tenancyViolations())->toBe(['sales_quotes.party_id' => 1])
        ->and(Artisan::call('master-data:audit-tenancy'))->toBe(1);
});
