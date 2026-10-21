<?php

declare(strict_types=1);

use App\Modules\Inventory\Enums\DocumentType;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Accounting\Books;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company);
    $this->second = Inv::warehouse($this->company, 'SECOND', 'allow');
    $this->bin = Inv::location($this->company, $this->wh, 'A-01');
    $this->item = Inv::item($this->company)->id;
    $this->lotItem = Inv::item($this->company, ['tracking' => 'lot', 'has_expiry' => true])->id;
});

/** SQLSTATE of a failing statement. */
function sqlState(Closure $fn): ?string
{
    try {
        DB::transaction($fn);
    } catch (QueryException $e) {
        return is_string($e->errorInfo[0] ?? null) ? $e->errorInfo[0] : null;
    }

    return null;
}

it('keeps balances equal to the movements and the stock account equal to the valuation', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->item, '20', '5', ['locationId' => $this->bin->id]);
    Inv::receive($this->company, $this->wh->id, $this->item, '7.5', '6.2');
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '10', '3', ['lotNo' => 'L1', 'expiry' => '2027-12-31']);
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '4', '3.5', ['lotNo' => 'L2', 'expiry' => '2027-09-30']);
    Inv::issue($this->company, $this->wh->id, $this->item, '12.25');
    Inv::issue($this->company, $this->wh->id, $this->lotItem, '6');
    Inv::post($this->company, DocumentType::Transfer, $this->wh->id, [Inv::line($this->item, '3', null, ['locationId' => $this->bin->id])], target: $this->second->id);
    Inv::post($this->company, DocumentType::Adjustment, $this->second->id, [Inv::line($this->item, '1', null, ['direction' => 'out'])]);
    Inv::post($this->company, DocumentType::Opening, $this->second->id, [Inv::line($this->lotItem, '2', '4', ['lotNo' => 'L3', 'expiry' => '2028-01-31'])]);

    $snapshot = Inv::invariants($this->company);
    expect($snapshot['balances'][0])->toBe($snapshot['balances'][1])->not->toBeEmpty()
        ->and($snapshot['values'][0])->toBe($snapshot['values'][1])
        ->and(Books::balance($this->company, '153'))->toBe(Inv::totalValue($this->company));

    // The rebuild reproduces the maintained figures exactly.
    $before = DB::table('stock_balances')->where('company_id', $this->company)->orderBy('item_id')->orderBy('warehouse_id')->orderBy('location_id')->orderBy('lot_id')
        ->get(['item_id', 'warehouse_id', 'location_id', 'lot_id', 'on_hand', 'reserved'])->map(fn ($r) => (array) $r)->all();
    expect(Artisan::call('inventory:rebuild-balances', ['company' => $this->company, '--check' => true]))->toBe(0);
    expect(Artisan::call('inventory:rebuild-balances', ['company' => $this->company]))->toBe(0);
    $after = DB::table('stock_balances')->where('company_id', $this->company)->orderBy('item_id')->orderBy('warehouse_id')->orderBy('location_id')->orderBy('lot_id')
        ->get(['item_id', 'warehouse_id', 'location_id', 'lot_id', 'on_hand', 'reserved'])->map(fn ($r) => (array) $r)->all();
    expect($after)->toEqual($before);
});

it('reports a balance that drifted from the movements', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->item, '5', '1');
    DB::table('stock_balances')->where('item_id', $this->item)->update(['on_hand' => '4']);

    expect(Artisan::call('inventory:rebuild-balances', ['company' => $this->company, '--check' => true]))->toBe(1);
    Artisan::call('inventory:rebuild-balances', ['company' => $this->company]);
    expect(Inv::onHand($this->company, $this->item, $this->wh->id))->toBe('5.000000');
});

it('rejects updating and deleting stock movements in raw SQL', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->item, '5', '1');
    $id = DB::table('stock_movements')->value('id');

    expect(sqlState(fn () => DB::table('stock_movements')->where('id', $id)->update(['quantity' => '6'])))->toBe('KI001')
        ->and(sqlState(fn () => DB::table('stock_movements')->where('id', $id)->delete()))->toBe('KI001');
});

it('rejects negative on hand where the warehouse blocks it, at commit', function (): void {
    $row = ['company_id' => $this->company, 'item_id' => $this->item, 'on_hand' => '-1'];

    expect(sqlState(function () use ($row): void {
        DB::table('stock_balances')->insert([...$row, 'warehouse_id' => $this->wh->id]);
        DB::statement('SET CONSTRAINTS stock_balances_not_negative IMMEDIATE');
    }))->toBe('KI002');

    // The second warehouse allows negative stock.
    expect(sqlState(function () use ($row): void {
        DB::table('stock_balances')->insert([...$row, 'warehouse_id' => $this->second->id]);
        DB::statement('SET CONSTRAINTS stock_balances_not_negative IMMEDIATE');
    }))->toBeNull();
});

it('rejects invalid serial states and transitions in raw SQL', function (): void {
    $serialItem = Inv::item($this->company, ['tracking' => 'serial'])->id;
    $base = ['company_id' => $this->company, 'item_id' => $serialItem, 'created_at' => now(), 'updated_at' => now()];

    expect(sqlState(fn () => DB::table('stock_serials')->insert([...$base, 'id' => (string) Str::uuid7(), 'serial_no' => 'S0', 'status' => 'issued'])))->toBe('KI003');

    $id = (string) Str::uuid7();
    DB::table('stock_serials')->insert([...$base, 'id' => $id, 'serial_no' => 'S1', 'status' => 'in_stock', 'warehouse_id' => $this->wh->id]);
    DB::table('stock_serials')->where('id', $id)->update(['status' => 'issued', 'warehouse_id' => null]);

    expect(sqlState(fn () => DB::table('stock_serials')->where('id', $id)->update(['status' => 'reserved', 'warehouse_id' => $this->wh->id])))->toBe('KI003')
        ->and(sqlState(fn () => DB::table('stock_serials')->where('id', $id)->update(['serial_no' => 'S2'])))->toBe('KI003');
});

it('rejects a movement whose lot belongs to another item', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '1', '1', ['lotNo' => 'X', 'expiry' => '2027-12-31']);
    $lot = DB::table('stock_lots')->value('id');

    expect(sqlState(fn () => DB::table('stock_movements')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $this->company, 'item_id' => $this->item, 'warehouse_id' => $this->wh->id, 'lot_id' => $lot,
        'movement_type' => 'receipt', 'direction' => 'in', 'quantity' => '1', 'unit_cost' => '1', 'total_cost' => '1', 'occurred_at' => '2027-06-10',
        'document_type' => 'stock_document', 'document_id' => (string) Str::uuid7(),
    ])))->toBe('KI004');
});

it('rejects changes to posted stock documents and their lines', function (): void {
    $posted = Inv::receive($this->company, $this->wh->id, $this->item, '1', '1');

    expect(sqlState(fn () => DB::table('stock_documents')->where('id', $posted->documentId)->update(['notes' => 'x'])))->toBe('KI005')
        ->and(sqlState(fn () => DB::table('stock_documents')->where('id', $posted->documentId)->delete()))->toBe('KI005')
        ->and(sqlState(fn () => DB::table('stock_document_lines')->where('document_id', $posted->documentId)->update(['quantity' => '2'])))->toBe('KI005');
});

it('allows only one default warehouse per company', function (): void {
    Inv::warehouse($this->company, 'D1', default: true);

    expect(sqlState(fn () => Inv::warehouse($this->company, 'D2', default: false)->forceFill(['is_default' => true])->saveQuietly()))->toBe('23505');
});
