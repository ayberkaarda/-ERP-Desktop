<?php

declare(strict_types=1);

use App\Modules\Accounting\Exceptions\PeriodNotOpen;
use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Events\StockReversed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company)->id;
    $this->item = Inv::item($this->company)->id;
});

function reverseDoc(string $company, string $id, string $date = '2027-06-12'): mixed
{
    return Inv::in($company, fn () => app(StockService::class)->reverse($id, new DateTimeImmutable($date), 'Wrong document'));
}

it('reverses a receipt with mirrored movements and a reversing journal entry', function (): void {
    Event::fake([StockReversed::class]);
    $receipt = Inv::receive($this->company, $this->wh, $this->item, '10', '7');

    $reversed = reverseDoc($this->company, $receipt->documentId);

    expect($reversed->status)->toBe('cancelled')
        ->and(Inv::onHand($this->company, $this->item, $this->wh))->toBe('0.000000')
        ->and(Inv::valuation($this->company, $this->item, $this->wh)['value'])->toBe('0.0000')
        ->and(Books::balance($this->company, '153'))->toBe('0.0000')
        ->and(DB::table('stock_movements')->where('document_id', $receipt->documentId)->whereNotNull('reverses_id')->count())->toBe(1)
        ->and(DB::table('journal_entries')->where('id', $receipt->journalEntryId)->value('status'))->toBe('reversed');
    Event::assertDispatched(StockReversed::class);

    expect(fn () => reverseDoc($this->company, $receipt->documentId))->toThrow(ValidationException::class, 'already been reversed');
});

it('refuses a reversal that would make stock negative or before the document date', function (): void {
    $receipt = Inv::receive($this->company, $this->wh, $this->item, '10', '7');
    Inv::issue($this->company, $this->wh, $this->item, '4');

    expect(fn () => reverseDoc($this->company, $receipt->documentId))->toThrow(ValidationException::class, 'negative');
    expect(fn () => reverseDoc($this->company, $receipt->documentId, '2027-06-01'))->toThrow(ValidationException::class, 'before the document date');
    expect(Inv::onHand($this->company, $this->item, $this->wh))->toBe('6.000000');
});

it('reverses an issue back into stock at its original cost', function (): void {
    Inv::receive($this->company, $this->wh, $this->item, '10', '10');
    $issue = Inv::issue($this->company, $this->wh, $this->item, '4');
    Inv::receive($this->company, $this->wh, $this->item, '6', '20');

    reverseDoc($this->company, $issue->documentId);

    // 60 + 120 + 40 = 220 over 16
    expect(Inv::valuation($this->company, $this->item, $this->wh))->toBe(['quantity' => '16.000000', 'value' => '220.0000', 'avg_cost' => '13.750000'])
        ->and(Books::balance($this->company, '153'))->toBe('220.0000')
        ->and(Books::balance($this->company, '621'))->toBe('0.0000');
});

it('refuses to reverse a FIFO receipt whose layer was consumed and restores consumed layers on issue reversal', function (): void {
    Inv::fifo($this->company);
    $first = Inv::receive($this->company, $this->wh, $this->item, '5', '10', date: '2027-06-01');
    Inv::receive($this->company, $this->wh, $this->item, '5', '12', date: '2027-06-02');
    $issue = Inv::issue($this->company, $this->wh, $this->item, '6');

    expect(fn () => reverseDoc($this->company, $first->documentId))->toThrow(ValidationException::class, 'cost layer is consumed');

    reverseDoc($this->company, $issue->documentId);
    expect(DB::table('stock_cost_layers')->orderBy('received_at')->pluck('remaining_qty')->all())->toBe(['5.000000', '5.000000'])
        ->and(Inv::valuation($this->company, $this->item, $this->wh)['value'])->toBe('110.0000');
});

it('refuses to reverse a serial receipt once a unit has left', function (): void {
    $serialItem = Inv::item($this->company, ['tracking' => 'serial'])->id;
    $receipt = Inv::receive($this->company, $this->wh, $serialItem, '2', '5', ['serials' => ['A', 'B']]);
    Inv::issue($this->company, $this->wh, $serialItem, '1', ['serials' => ['A']]);

    expect(fn () => reverseDoc($this->company, $receipt->documentId))->toThrow(ValidationException::class, 'Serial number A');
});

it('refuses postings into a closed period', function (): void {
    expect(fn () => Inv::receive($this->company, $this->wh, $this->item, '1', '1', date: '2026-06-10'))->toThrow(PeriodNotOpen::class);
});

it('posts a count with variances against the frozen system quantities', function (): void {
    $other = Inv::item($this->company)->id;
    Inv::receive($this->company, $this->wh, $this->item, '10', '5');
    Inv::receive($this->company, $this->wh, $other, '4', '2.5');
    $user = Actors::user(['inventory.documents.create', 'inventory.documents.post', 'inventory.documents.view']);

    $count = Inv::postJson($user, $this->company, 'stock-documents', ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh])
        ->assertCreated()->assertJsonCount(2, 'data.lines')->json('data');
    $lines = collect($count['lines'])->keyBy('item_id');
    expect($lines[$this->item]['system_quantity'])->toBe('10.000000');

    // Stock moving after the freeze does not change the snapshot.
    Inv::issue($this->company, $this->wh, $this->item, '1');

    Inv::as($user, $this->company)->patchJson("/api/v1/stock-documents/{$count['id']}/counts", ['version' => $count['version'], 'counts' => [
        ['line_id' => $lines[$this->item]['id'], 'counted_quantity' => '8'],
        ['line_id' => $lines[$other]['id'], 'counted_quantity' => '5'],
    ]])->assertOk();
    expect(DB::table('stock_document_lines')->where('id', $lines[$this->item]['id'])->value('counted_quantity'))->toBe('8.000000');

    Inv::postJson($user, $this->company, "stock-documents/{$count['id']}/post")->assertOk()->assertJsonPath('data.status', 'posted');

    expect(Inv::onHand($this->company, $this->item, $this->wh))->toBe('7.000000')
        ->and(Inv::onHand($this->company, $other, $this->wh))->toBe('5.000000')
        ->and(Books::balance($this->company, '197'))->toBe('10.0000')   // 2 x 5 shortage
        ->and(Books::balance($this->company, '397'))->toBe('-62.5000')  // receipts 50 + 10 and the 2.5 surplus
        ->and(DB::table('stock_movements')->where('movement_type', 'count_adjustment')->count())->toBe(2);

    $snapshot = Inv::invariants($this->company);
    expect($snapshot['balances'][0])->toBe($snapshot['balances'][1])
        ->and(Books::balance($this->company, '153'))->toBe(Inv::totalValue($this->company));
});

it('imports counted quantities from CSV with a dry run first', function (): void {
    $item = Inv::item($this->company, ['code' => 'CSV-1'])->id;
    Inv::receive($this->company, $this->wh, $item, '3', '1');
    $user = Actors::user(['inventory.documents.create']);
    $count = Inv::postJson($user, $this->company, 'stock-documents', ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh])->json('data');
    $file = UploadedFile::fake()->createWithContent('count.csv', "item_code,counted_quantity\nCSV-1,2\nNOPE,1\n");

    Inv::as($user, $this->company)->post("/api/v1/stock-documents/{$count['id']}/import", ['file' => $file, 'dry_run' => '1'], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertOk()->assertJsonPath('data.valid', 1)->assertJsonPath('data.errors.0.row', 3)->assertJsonPath('data.applied', false);

    $good = UploadedFile::fake()->createWithContent('count.csv', "item_code;counted_quantity\nCSV-1;2\n");
    Inv::as($user, $this->company)->post("/api/v1/stock-documents/{$count['id']}/import", ['file' => $good, 'version' => $count['version']], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertOk()->assertJsonPath('data.applied', true);

    expect(DB::table('stock_document_lines')->where('document_id', $count['id'])->value('counted_quantity'))->toBe('2.000000');
});
