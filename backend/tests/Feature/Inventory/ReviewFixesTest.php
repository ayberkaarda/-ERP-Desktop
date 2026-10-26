<?php

declare(strict_types=1);

use App\Core\Http\ApiException;
use App\Modules\Inventory\Contracts\Reservations;
use App\Modules\Inventory\Data\ReservationRequest;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Services\Ledger\PostOptions;
use App\Modules\Inventory\Services\Ledger\StockLedger;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company);
    $this->lotItem = Inv::item($this->company, ['tracking' => 'lot'])->id;
    $this->user = Actors::user(['inventory.documents.create', 'inventory.documents.post', 'inventory.documents.view']);
});

function lotId(string $no): string
{
    return (string) DB::table('stock_lots')->where('lot_no', $no)->value('id');
}

function reserve(string $company, string $item, string $wh, string $qty, ?string $lot = null): mixed
{
    return app(Reservations::class)->reserve(new ReservationRequest($company, $item, $wh, $qty, $lot));
}

it('judges allow_expired on the locked document, not on the copy the caller loaded', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '5', '1', ['lotNo' => 'OLD']);
    $id = Inv::postJson($this->user, $this->company, 'stock-documents', [
        'doc_type' => 'issue', 'document_date' => '2027-06-10', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $this->lotItem, 'quantity' => '1']],
    ])->json('data.id');
    $stale = Inv::in($this->company, fn () => StockDocument::query()->findOrFail($id));
    // A concurrent edit switches the flag on after the caller read the document.
    DB::table('stock_documents')->where('id', $id)->update(['allow_expired' => true]);

    expect(fn () => Inv::in($this->company, fn () => app(StockLedger::class)->post($stale, new PostOptions(expiredAllowed: false))))
        ->toThrow(ApiException::class);
    expect(DB::table('stock_documents')->where('id', $id)->value('status'))->toBe('draft');
});

it('enforces warehouse and lot availability for hard lot reservations', function (): void {
    Inv::policy($this->company, $this->wh->id, 'hard');
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '10', '1', ['lotNo' => 'A']);
    reserve($this->company, $this->lotItem, $this->wh->id, '10');

    expect(fn () => reserve($this->company, $this->lotItem, $this->wh->id, '10', lotId('A')))->toThrow(ValidationException::class, 'available');
    expect(DB::table('stock_reservations')->count())->toBe(1);
});

it('keeps another reservation\'s lot out of unreserved issues under a hard policy', function (): void {
    Inv::policy($this->company, $this->wh->id, 'hard');
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '10', '1', ['lotNo' => 'A']);
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '10', '1', ['lotNo' => 'B']);
    reserve($this->company, $this->lotItem, $this->wh->id, '10', lotId('A'));

    expect(fn () => Inv::issue($this->company, $this->wh->id, $this->lotItem, '10', ['lotNo' => 'A']))->toThrow(ValidationException::class, 'reserved');

    // FEFO passes over the held lot.
    $issue = Inv::issue($this->company, $this->wh->id, $this->lotItem, '10');
    expect(DB::table('stock_movements')->where('document_id', $issue->documentId)->value('lot_id'))->toBe(lotId('B'));
});

it('consumes only the issued quantity of a reservation and keeps it to its lot', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '10', '1', ['lotNo' => 'A']);
    Inv::receive($this->company, $this->wh->id, $this->lotItem, '10', '1', ['lotNo' => 'B']);
    $held = reserve($this->company, $this->lotItem, $this->wh->id, '10', lotId('B'));

    expect(fn () => Inv::issue($this->company, $this->wh->id, $this->lotItem, '1', ['lotNo' => 'A', 'reservationId' => $held->id]))
        ->toThrow(ValidationException::class, 'another lot');

    $issue = Inv::issue($this->company, $this->wh->id, $this->lotItem, '1', ['reservationId' => $held->id]);
    $row = DB::table('stock_reservations')->where('id', $held->id)->first();

    expect($row->status)->toBe('active')->and($row->quantity)->toBe('9.000000')
        ->and(DB::table('stock_balances')->sum('reserved'))->toBe('9.000000')
        ->and(DB::table('stock_movements')->where('document_id', $issue->documentId)->value('lot_id'))->toBe(lotId('B'));
});

it('keeps the warehouse of a frozen count', function (): void {
    $other = Inv::warehouse($this->company, 'OTHER');
    $count = Inv::postJson($this->user, $this->company, 'stock-documents', ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id])->json('data');

    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-documents/{$count['id']}", ['version' => $count['version'], 'warehouse_id' => $other->id])
        ->assertStatus(422)->assertJsonPath('errors.fields.warehouse_id.0', fn ($m) => str_contains($m, 'frozen'));
});

it('keeps one count line per balance key', function (): void {
    $item = Inv::item($this->company)->id;
    Inv::receive($this->company, $this->wh->id, $item, '10', '1');
    $count = Inv::postJson($this->user, $this->company, 'stock-documents', ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id])->json('data');
    $line = $count['lines'][0]['id'];

    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-documents/{$count['id']}/counts", [
        'version' => $count['version'],
        'counts' => [['line_id' => $line, 'counted_quantity' => '8']],
        'add' => [['item_id' => $item, 'counted_quantity' => '8'], ['item_id' => $item, 'counted_quantity' => '8']],
    ])->assertOk()->assertJsonCount(1, 'data.lines');

    Inv::postJson($this->user, $this->company, "stock-documents/{$count['id']}/post")->assertOk();
    expect(Inv::onHand($this->company, $item, $this->wh->id))->toBe('8.000000');
});

it('counts negative stock back to the counted quantity', function (): void {
    $wh = Inv::warehouse($this->company, 'NEG', 'allow');
    $item = Inv::item($this->company)->id;
    Inv::receive($this->company, $wh->id, $item, '1', '2');
    Inv::issue($this->company, $wh->id, $item, '6');
    $count = Inv::postJson($this->user, $this->company, 'stock-documents', ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $wh->id])
        ->assertCreated()->assertJsonPath('data.lines.0.system_quantity', '-5.000000')->json('data');

    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-documents/{$count['id']}/counts", [
        'version' => $count['version'], 'counts' => [['line_id' => $count['lines'][0]['id'], 'counted_quantity' => '0']],
    ])->assertOk();
    Inv::postJson($this->user, $this->company, "stock-documents/{$count['id']}/post")->assertOk();

    expect(Inv::onHand($this->company, $item, $wh->id))->toBe('0.000000');
});

it('gives a returned serial unit the lot it comes back in', function (): void {
    $item = Inv::item($this->company, ['tracking' => 'serial'])->id;
    Inv::receive($this->company, $this->wh->id, $item, '1', '5', ['serials' => ['S'], 'lotNo' => 'A']);
    Inv::issue($this->company, $this->wh->id, $item, '1', ['serials' => ['S']]);
    Inv::receive($this->company, $this->wh->id, $item, '1', '5', ['serials' => ['S'], 'lotNo' => 'B']);

    expect(DB::table('stock_serials')->where('serial_no', 'S')->value('lot_id'))->toBe(lotId('B'));

    Inv::issue($this->company, $this->wh->id, $item, '1', ['serials' => ['S']]);
    $byLot = DB::table('stock_balances')->where('item_id', $item)->pluck('on_hand', 'lot_id')->all();
    expect($byLot[lotId('A')])->toBe('0.000000')->and($byLot[lotId('B')])->toBe('0.000000');
});

it('makes balance row values add up to the valuation, also after a rebuild', function (): void {
    $item = Inv::item($this->company)->id;
    $bin = Inv::location($this->company, $this->wh, 'B1');
    Inv::receive($this->company, $this->wh->id, $item, '1000', '1', ['locationId' => $bin->id]);
    Inv::receive($this->company, $this->wh->id, $item, '1000', '0.000001');
    Inv::post($this->company, DocumentType::Transfer, $this->wh->id, [Inv::line($item, '333', null, ['locationId' => $bin->id, 'targetLocationId' => null])], target: $this->wh->id);

    $sum = fn (): string => (string) DB::table('stock_balances')->where('item_id', $item)->sum('value');
    expect(Inv::valuation($this->company, $item, $this->wh->id)['value'])->toBe('1000.0010')
        ->and($sum())->toBe('1000.0010');

    Artisan::call('inventory:rebuild-balances', ['company' => $this->company]);
    expect($sum())->toBe('1000.0010');
});
