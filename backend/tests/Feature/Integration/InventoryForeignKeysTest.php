<?php

declare(strict_types=1);

use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

const INVENTORY_FK_MIGRATION = 'database/migrations/2027_02_01_900100_add_inventory_foreign_keys.php';

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company);
    $this->item = Inv::item($this->company)->id;
});

/** Foreign keys of the schema as "table.column" => "referenced table:delete rule:update rule". */
function inventoryForeignKeys(): array
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

/** A draft stock document with one raw line (drafts are mutable). */
function inventoryDraftWith(string $company, string $warehouse, string $item, array $line = [], array $doc = []): string
{
    $id = (string) Str::uuid7();
    DB::table('stock_documents')->insert([
        'id' => $id, 'company_id' => $company, 'doc_type' => 'receipt', 'status' => 'draft', 'document_date' => '2027-06-10',
        'warehouse_id' => $warehouse, 'version' => 1, 'created_at' => now(), 'updated_at' => now(), ...$doc,
    ]);
    DB::table('stock_document_lines')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $company, 'document_id' => $id, 'line_no' => 1, 'item_id' => $item,
        'unit_id' => DB::table('items')->where('id', $item)->value('base_unit_id'), 'quantity' => '1', 'base_quantity' => '1', ...$line,
    ]);

    return $id;
}

it('constrains every inventory table to companies and its cross-module references with RESTRICT', function (): void {
    $keys = inventoryForeignKeys();

    foreach (MasterDataIntegrity::INVENTORY_COMPANY_TABLES as $table) {
        expect($keys["{$table}.company_id"] ?? null)->toBe('companies:RESTRICT:RESTRICT', $table);
    }

    foreach (MasterDataIntegrity::INVENTORY_CROSS_MODULE as [$table, $column, $references]) {
        expect($keys["{$table}.{$column}"] ?? null)->toBe("{$references}:RESTRICT:RESTRICT", "{$table}.{$column}");
    }

    // Same-module keys of the Inventory migrations are still in place; sentinel columns stay free.
    expect($keys['stock_movements.lot_id'])->toBe('stock_lots:RESTRICT:NO ACTION')
        ->and($keys['stock_document_lines.document_id'])->toBe('stock_documents:CASCADE:NO ACTION')
        ->and(array_key_exists('stock_balances.location_id', $keys))->toBeFalse()
        ->and(array_key_exists('stock_balances.lot_id', $keys))->toBeFalse()
        ->and(array_key_exists('stock_movements.document_id', $keys))->toBeFalse();
});

it('rejects stock rows pointing at items, units, warehouses or locations that do not exist', function (string $where, string $column): void {
    $missing = '0190a1b2-0000-7000-8000-0000000000aa';

    expect(fn () => DB::transaction(fn () => $where === 'line'
        ? inventoryDraftWith($this->company, $this->wh->id, $this->item, [$column => $missing])
        : inventoryDraftWith($this->company, $this->wh->id, $this->item, [], [$column => $missing])))
        ->toThrow(QueryException::class, ($where === 'line' ? 'stock_document_lines_' : 'stock_documents_').$column.'_foreign');
})->with([
    'warehouse' => ['document', 'warehouse_id'],
    'posted by' => ['document', 'created_by'],
    'item' => ['line', 'item_id'],
    'unit' => ['line', 'unit_id'],
    'location' => ['line', 'location_id'],
]);

it('refuses the hard delete of an item or warehouse the ledger uses and leaves the movements unchanged', function (): void {
    $posted = Inv::receive($this->company, $this->wh->id, $this->item, '3', '2');
    $movements = DB::table('stock_movements')->where('document_id', $posted->documentId)->count();

    expect(fn () => DB::transaction(fn () => DB::table('items')->where('id', $this->item)->delete()))
        ->toThrow(QueryException::class, '_item_id_foreign');
    expect(fn () => DB::transaction(fn () => DB::table('warehouses')->where('id', $this->wh->id)->delete()))
        ->toThrow(QueryException::class, '_warehouse_id_foreign');
    // The append-only trigger still rejects any attempt to detach the movement instead.
    expect(fn () => DB::transaction(fn () => DB::table('stock_movements')->where('document_id', $posted->documentId)->update(['location_id' => null])))
        ->toThrow(QueryException::class);

    expect(DB::table('stock_movements')->where('document_id', $posted->documentId)->count())->toBe($movements)
        ->and(Inv::invariants($this->company)['balances'][0])->toBe(Inv::invariants($this->company)['balances'][1]);
});

it('links a posted document and its movements to the journal entry through a validated key', function (): void {
    $posted = Inv::post($this->company, DocumentType::Receipt, $this->wh->id, [Inv::line($this->item, '2', '5')]);
    $entry = DB::table('stock_documents')->where('id', $posted->documentId)->value('journal_entry_id');

    expect($entry)->not->toBeNull()
        ->and(DB::table('stock_movements')->where('document_id', $posted->documentId)->where('journal_entry_id', $entry)->exists())->toBeTrue();
    $state = DB::selectOne("SELECT convalidated FROM pg_constraint WHERE conname = 'stock_movements_journal_entry_id_foreign'");
    expect($state?->convalidated)->toBeTrue();
});

it('refuses to add the keys over orphan stock rows with counts and validates them once fixed', function (): void {
    /** @var Migration $migration */
    $migration = require base_path(INVENTORY_FK_MIGRATION);
    $migration->down();
    expect(array_key_exists('stock_document_lines.item_id', inventoryForeignKeys()))->toBeFalse();

    $doc = inventoryDraftWith($this->company, $this->wh->id, $this->item);
    DB::table('stock_document_lines')->where('document_id', $doc)->update(['item_id' => (string) Str::uuid7()]);
    DB::statement('SET CONSTRAINTS ALL IMMEDIATE');

    try {
        $migration->up();
        $this->fail('The migration must refuse orphan rows.');
    } catch (RuntimeException $e) {
        expect($e->getMessage())->toContain('stock_document_lines.item_id: 1')->toContain('Stock rows are never changed automatically');
    }
    expect(array_key_exists('stock_document_lines.item_id', inventoryForeignKeys()))->toBeFalse();

    DB::table('stock_documents')->where('id', $doc)->delete();
    DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
    $migration->up();

    $state = DB::selectOne("SELECT convalidated FROM pg_constraint WHERE conname = 'stock_document_lines_item_id_foreign'");
    expect($state?->convalidated)->toBeTrue()
        ->and(inventoryForeignKeys()['stock_movements.company_id'])->toBe('companies:RESTRICT:RESTRICT');
});

it('reports stock documents whose warehouse belongs to another company in the tenancy audit', function (): void {
    $other = Inv::company();
    $foreign = Inv::warehouse($other, 'FOREIGN');
    inventoryDraftWith($this->company, $foreign->id, $this->item);

    expect((new MasterDataIntegrity(DB::connection()))->tenancyViolations())->toBe(['stock_documents.warehouse_id' => 1])
        ->and(Artisan::call('master-data:audit-tenancy'))->toBe(1);
});
