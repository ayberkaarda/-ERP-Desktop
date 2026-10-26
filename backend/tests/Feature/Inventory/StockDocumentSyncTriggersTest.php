<?php

declare(strict_types=1);

use App\Modules\Inventory\Models\StockDocument;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;
use Tests\Support\Sync;

/*
 * Committed writes (SyncDatabase): sync_txid values are real transaction ids. Also shows the
 * syncable triggers next to the stock guards: KI005 on posted documents and lines, the
 * append-only movements (KI001) and the cleanup that must not trip the TRUNCATE guard.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company, 'MAIN', default: true);
    $this->item = Inv::item($this->company)->id;
    Inv::receive($this->company, $this->wh->id, $this->item, '10', '2');
    $this->user = Actors::user(Inv::ALL);
});

function invCommitted(Closure $fn): void
{
    DB::transaction($fn);
}

it('stamps the header, touches it from line changes without bumping the version, and writes tombstones', function (): void {
    $doc = Inv::postJson($this->user, $this->company, 'stock-documents', ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id])
        ->assertCreated()->json('data');
    $before = Sync::txidOf('stock_documents', $doc['id']);
    $meta = DB::table('stock_documents')->where('id', $doc['id'])->first(['version', 'updated_at']);

    invCommitted(fn () => DB::table('stock_document_lines')->where('document_id', $doc['id'])->update(['counted_quantity' => '7']));

    $after = Sync::txidOf('stock_documents', $doc['id']);
    $row = DB::table('stock_documents')->where('id', $doc['id'])->first(['version', 'updated_at']);
    expect($after->greaterThan($before))->toBeTrue()
        ->and($row->version)->toBe($meta->version)
        ->and($row->updated_at)->toBe($meta->updated_at);

    Sync::awaitHorizonPast($after);
    expect(Sync::belowHorizon('stock_documents'))->toContain($doc['id']);

    Inv::as($this->user, $this->company)->deleteJson("/api/v1/stock-documents/{$doc['id']}")->assertNoContent();
    $tomb = Sync::tombstone('stock_documents', $doc['id']);
    expect($tomb)->not->toBeNull()->and($tomb->company_id)->toBe($this->company)
        ->and(Sync::tombstone('stock_document_lines', $doc['lines'][0]['id'] ?? ''))->toBeNull();
});

it('posts and reverses a tracked document and keeps posted documents and lines immutable', function (): void {
    $doc = Inv::postJson($this->user, $this->company, 'stock-documents', [
        'doc_type' => 'receipt', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $this->item, 'quantity' => '2', 'unit_cost' => '3']],
    ])->assertCreated()->json('data');
    $draftTx = Sync::txidOf('stock_documents', $doc['id']);

    $posted = Inv::postJson($this->user, $this->company, "stock-documents/{$doc['id']}/post")->assertOk()->json('data');
    $postedTx = Sync::txidOf('stock_documents', $doc['id']);
    expect($postedTx->greaterThan($draftTx))->toBeTrue();

    // The guards still refuse changes to a posted document and its lines.
    expect(fn () => DB::table('stock_documents')->where('id', $doc['id'])->update(['notes' => 'x']))->toThrow(QueryException::class);
    expect(fn () => DB::table('stock_document_lines')->where('document_id', $doc['id'])->update(['notes' => 'x']))->toThrow(QueryException::class);

    Inv::postJson($this->user, $this->company, "stock-documents/{$doc['id']}/reverse", ['date' => '2027-06-12', 'reason' => 'mistake', 'version' => $posted['version']])->assertOk();
    $row = DB::table('stock_documents')->where('id', $doc['id'])->first(['status']);
    expect($row->status)->toBe('cancelled')->and(Sync::txidOf('stock_documents', $doc['id'])->greaterThan($postedTx))->toBeTrue();

    // Movements stay append-only and are not tracked.
    expect(fn () => DB::table('stock_movements')->update(['quantity' => '1']))->toThrow(QueryException::class)
        ->and(DB::getSchemaBuilder()->hasColumn('stock_movements', 'sync_txid'))->toBeFalse()
        ->and(DB::getSchemaBuilder()->hasColumn('stock_balances', 'sync_txid'))->toBeFalse();
});

it('puts the committed draft within reach of a pull', function (): void {
    $doc = Inv::postJson($this->user, $this->company, 'stock-documents', ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id])
        ->assertCreated()->json('data');
    Sync::awaitHorizonPast(Sync::txidOf('stock_documents', $doc['id']));

    expect(StockDocument::query()->withoutCompanyScope()->whereRaw('sync_txid < pg_snapshot_xmin(pg_current_snapshot())')->whereKey($doc['id'])->exists())->toBeTrue();
});
