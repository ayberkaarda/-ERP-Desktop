<?php

declare(strict_types=1);

use App\Modules\Inventory\Enums\DocumentType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company)->id;
    $this->lotItem = Inv::item($this->company, ['tracking' => 'lot', 'has_expiry' => true])->id;
    $this->serialItem = Inv::item($this->company, ['tracking' => 'serial'])->id;
});

function lotOf(string $movementDocument): array
{
    return DB::table('stock_movements as m')->join('stock_lots as l', 'l.id', '=', 'm.lot_id')
        ->where('m.document_id', $movementDocument)->orderBy('m.seq')->pluck('l.lot_no')->all();
}

it('requires a lot number and an expiry date for expiring lot items', function (): void {
    expect(fn () => Inv::receive($this->company, $this->wh, $this->lotItem, '1', '1'))->toThrow(ValidationException::class, 'lot number is required');
    expect(fn () => Inv::receive($this->company, $this->wh, $this->lotItem, '1', '1', ['lotNo' => 'L1']))->toThrow(ValidationException::class, 'expiry date');

    Inv::receive($this->company, $this->wh, $this->lotItem, '1', '1', ['lotNo' => 'L1', 'expiry' => '2027-12-31']);
    // A lot keeps its expiry date.
    expect(fn () => Inv::receive($this->company, $this->wh, $this->lotItem, '1', '1', ['lotNo' => 'L1', 'expiry' => '2028-01-31']))
        ->toThrow(ValidationException::class, 'already has the expiry date');
    expect(DB::table('stock_movements')->count())->toBe(1);
});

it('issues earliest expiry first and skips expired lots unless allowed', function (): void {
    Inv::receive($this->company, $this->wh, $this->lotItem, '5', '1', ['lotNo' => 'LATE', 'expiry' => '2027-12-31']);
    Inv::receive($this->company, $this->wh, $this->lotItem, '5', '1', ['lotNo' => 'SOON', 'expiry' => '2027-07-31']);
    Inv::receive($this->company, $this->wh, $this->lotItem, '5', '1', ['lotNo' => 'OLD', 'expiry' => '2027-06-01']);

    $issue = Inv::issue($this->company, $this->wh, $this->lotItem, '7');
    expect(lotOf($issue->documentId))->toBe(['SOON', 'LATE']);

    expect(fn () => Inv::issue($this->company, $this->wh, $this->lotItem, '4'))->toThrow(ValidationException::class, 'unexpired');
    expect(fn () => Inv::issue($this->company, $this->wh, $this->lotItem, '1', ['lotNo' => 'OLD']))->toThrow(ValidationException::class, 'expired on');

    $override = Inv::post($this->company, DocumentType::Issue, $this->wh, [Inv::line($this->lotItem, '1', null, ['lotNo' => 'OLD'])], allowExpired: true);
    expect(lotOf($override->documentId))->toBe(['OLD']);
});

it('needs the expired-issue permission to post a document that allows expired lots', function (): void {
    Inv::receive($this->company, $this->wh, $this->lotItem, '5', '1', ['lotNo' => 'OLD', 'expiry' => '2027-06-01']);
    $body = ['doc_type' => 'issue', 'document_date' => '2027-06-10', 'warehouse_id' => $this->wh, 'allow_expired' => true,
        'lines' => [['item_id' => $this->lotItem, 'quantity' => '1', 'lot_no' => 'OLD']]];
    $poster = Actors::user(['inventory.documents.create', 'inventory.documents.post']);
    $id = Inv::postJson($poster, $this->company, 'stock-documents', $body)->assertCreated()->json('data.id');

    Inv::postJson($poster, $this->company, "stock-documents/{$id}/post")->assertForbidden();

    $trusted = Actors::user(['inventory.documents.post', 'inventory.documents.issue_expired']);
    Inv::postJson($trusted, $this->company, "stock-documents/{$id}/post")->assertOk()->assertJsonPath('data.status', 'posted');
});

it('takes one serial number per unit and tracks each unit', function (): void {
    expect(fn () => Inv::receive($this->company, $this->wh, $this->serialItem, '2', '100', ['serials' => ['A']]))->toThrow(ValidationException::class, 'one serial number per unit');
    expect(fn () => Inv::receive($this->company, $this->wh, $this->serialItem, '2', '100', ['serials' => ['A', 'A']]))->toThrow(ValidationException::class, 'unique');
    expect(fn () => Inv::receive($this->company, $this->wh, $this->serialItem, '1.5', '100', ['serials' => ['A']]))->toThrow(ValidationException::class);

    Inv::receive($this->company, $this->wh, $this->serialItem, '3', '100', ['serials' => ['A', 'B', 'C']]);
    expect(DB::table('stock_serials')->where('status', 'in_stock')->count())->toBe(3)
        ->and(DB::table('stock_movements')->where('item_id', $this->serialItem)->count())->toBe(3);

    expect(fn () => Inv::receive($this->company, $this->wh, $this->serialItem, '1', '100', ['serials' => ['B']]))->toThrow(ValidationException::class, 'already in stock');

    Inv::issue($this->company, $this->wh, $this->serialItem, '1', ['serials' => ['B']]);
    expect(DB::table('stock_serials')->where('serial_no', 'B')->value('status'))->toBe('issued')
        ->and(Inv::onHand($this->company, $this->serialItem, $this->wh))->toBe('2.000000');

    expect(fn () => Inv::issue($this->company, $this->wh, $this->serialItem, '1', ['serials' => ['B']]))->toThrow(ValidationException::class, 'not in stock here');
    expect(fn () => Inv::issue($this->company, $this->wh, $this->serialItem, '1', ['serials' => ['Z']]))->toThrow(ValidationException::class, 'does not exist');

    // A returned unit comes back in stock.
    Inv::receive($this->company, $this->wh, $this->serialItem, '1', '100', ['serials' => ['B']]);
    expect(DB::table('stock_serials')->where('serial_no', 'B')->value('status'))->toBe('in_stock');
});

it('moves serial units with a transfer and traces them', function (): void {
    $second = Inv::warehouse($this->company, 'SECOND')->id;
    Inv::receive($this->company, $this->wh, $this->serialItem, '2', '50', ['serials' => ['S1', 'S2']]);
    Inv::post($this->company, DocumentType::Transfer, $this->wh, [Inv::line($this->serialItem, '1', null, ['serials' => ['S2']])], target: $second);

    expect(DB::table('stock_serials')->where('serial_no', 'S2')->value('warehouse_id'))->toBe($second)
        ->and(DB::table('stock_serials')->where('serial_no', 'S2')->value('status'))->toBe('in_stock');

    $viewer = Actors::user(['inventory.stock.view']);
    $id = DB::table('stock_serials')->where('serial_no', 'S2')->value('id');
    Inv::as($viewer, $this->company)->getJson("/api/v1/stock-serials/{$id}")->assertOk()
        ->assertJsonCount(3, 'data.movements')->assertJsonPath('data.movements.1.movement_type', 'transfer_out');
});

it('traces a lot from receipt to issue', function (): void {
    Inv::receive($this->company, $this->wh, $this->lotItem, '5', '2', ['lotNo' => 'T1', 'expiry' => '2027-12-31']);
    Inv::issue($this->company, $this->wh, $this->lotItem, '3');
    $lot = DB::table('stock_lots')->value('id');
    $viewer = Actors::user(['inventory.stock.view']);

    Inv::as($viewer, $this->company)->getJson("/api/v1/stock-lots/{$lot}/trace")->assertOk()
        ->assertJsonPath('data.lot.on_hand', '2.000000')
        ->assertJsonPath('data.summary.0.received', '5.000000')
        ->assertJsonPath('data.summary.0.issued', '3.000000')
        ->assertJsonCount(2, 'data.movements');

    Inv::as($viewer, $this->company)->getJson('/api/v1/stock-lots?filter[expires_before]=2027-12-31&filter[with_stock]=1')->assertOk()->assertJsonCount(1, 'data');
});
