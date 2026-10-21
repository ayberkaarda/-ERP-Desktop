<?php

declare(strict_types=1);

use App\Modules\Catalog\Contracts\ItemUsageChecker;
use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Events\StockBelowReorderPoint;
use App\Modules\Inventory\Events\StockPosted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company, 'MAIN', default: true);
    $this->unit = Inv::unit($this->company);
    $this->box = Inv::unit($this->company, 'BOX');
    $this->itemModel = Inv::item($this->company, ['code' => 'WIDGET', 'name' => 'Widget'], $this->unit);
    Catalog::itemUnit($this->company, $this->itemModel, $this->box, '12');
    $this->item = $this->itemModel->id;
    $this->user = Actors::user(Inv::ALL);
});

it('creates, edits and posts a receipt draft with unit conversion and a gapless number', function (): void {
    Event::fake([StockPosted::class]);
    $draft = Inv::postJson($this->user, $this->company, 'stock-documents', [
        'doc_type' => 'receipt', 'document_date' => '2027-06-10', 'warehouse_id' => $this->wh->id, 'reason' => 'Supplier delivery',
        'lines' => [['item_id' => $this->item, 'unit_id' => $this->box->id, 'quantity' => '2', 'unit_cost' => '1.5']],
    ])->assertCreated()
        ->assertJsonPath('data.status', 'draft')->assertJsonPath('data.number', null)
        ->assertJsonPath('data.lines.0.base_quantity', '24.000000')
        ->json('data');

    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-documents/{$draft['id']}", [
        'version' => $draft['version'], 'lines' => [['item_id' => $this->item, 'quantity' => '30', 'unit_cost' => '2']],
    ])->assertOk()->assertJsonPath('data.lines.0.base_quantity', '30.000000')->assertJsonPath('data.version', 2);

    // A stale version is a conflict.
    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-documents/{$draft['id']}", ['version' => 1, 'reason' => 'x'])->assertStatus(409);

    $posted = Inv::postJson($this->user, $this->company, "stock-documents/{$draft['id']}/post", ['version' => 2])->assertOk()
        ->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'REC2027000000001')->json('data');
    expect($posted['journal_entry_id'])->not->toBeNull();
    Event::assertDispatched(StockPosted::class);

    // Posted documents are immutable through the API too.
    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-documents/{$draft['id']}", ['version' => $posted['version'], 'reason' => 'x'])->assertStatus(422);
    Inv::as($this->user, $this->company)->deleteJson("/api/v1/stock-documents/{$draft['id']}")->assertStatus(422);

    $second = Inv::receive($this->company, $this->wh->id, $this->item, '1', '1');
    expect($second->number)->toBe('REC2027000000002');

    Inv::as($this->user, $this->company)->getJson("/api/v1/stock-documents/{$draft['id']}")->assertOk()
        ->assertJsonPath('data.lines.0.unit_cost', '2.000000')->assertJsonStructure(['data' => ['audit']]);
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-documents?filter[doc_type]=receipt&filter[status]=posted&filter[item_id]='.$this->item.'&filter[date_from]=2027-06-01')
        ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.pagination.total', 2);
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-documents?q=Supplier')->assertOk()->assertJsonCount(1, 'data');
});

it('refuses an issue beyond stock and a draft for a service item', function (): void {
    $service = Inv::item($this->company, ['type' => 'service'])->id;
    Inv::postJson($this->user, $this->company, 'stock-documents', [
        'doc_type' => 'receipt', 'document_date' => '2027-06-10', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $service, 'quantity' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn ($f) => isset($f['lines.0.item_id']));

    $draft = Inv::postJson($this->user, $this->company, 'stock-documents', [
        'doc_type' => 'issue', 'document_date' => '2027-06-10', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $this->item, 'quantity' => '1']],
    ])->assertCreated()->json('data');
    Inv::postJson($this->user, $this->company, "stock-documents/{$draft['id']}/post")->assertStatus(422);
    expect(DB::table('stock_documents')->where('id', $draft['id'])->value('status'))->toBe('draft');

    Inv::as($this->user, $this->company)->deleteJson("/api/v1/stock-documents/{$draft['id']}")->assertNoContent();
});

it('serves balances, item stock, movements with a cursor, and exports', function (): void {
    $bin = Inv::location($this->company, $this->wh, 'B1');
    Inv::receive($this->company, $this->wh->id, $this->item, '10', '3', ['locationId' => $bin->id]);
    Inv::receive($this->company, $this->wh->id, $this->item, '5', '6');
    Inv::issue($this->company, $this->wh->id, $this->item, '3');

    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-balances')->assertOk()
        ->assertJsonPath('data.0.item_code', 'WIDGET')->assertJsonPath('data.0.warehouse_code', 'MAIN')
        ->assertJsonPath('data.0.on_hand', '12.000000')->assertJsonPath('data.0.avg_cost', '4.000000')->assertJsonPath('data.0.value', '48.0000');
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-balances?group_by=detail&sort=-on_hand')->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.location_code', 'B1');
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-balances?group_by=item&q=widg')->assertOk()->assertJsonCount(1, 'data');
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-balances?filter[nope]=1')->assertStatus(422);

    Inv::as($this->user, $this->company)->getJson("/api/v1/items/{$this->item}/stock")->assertOk()
        ->assertJsonPath('data.on_hand', '12.000000')->assertJsonPath('data.value', '48.0000')->assertJsonPath('data.warehouses.0.available', '12.000000');

    $page = Inv::as($this->user, $this->company)->getJson('/api/v1/stock-movements?per_page=2')->assertOk()->assertJsonCount(2, 'data');
    expect($page->json('data.0.direction'))->toBe('out')->and($page->json('data.0.signed_quantity'))->toBe('-3.000000');
    $cursor = $page->json('meta.next_cursor');
    Inv::as($this->user, $this->company)->getJson("/api/v1/stock-movements?per_page=2&cursor={$cursor}")->assertOk()
        ->assertJsonCount(1, 'data')->assertJsonPath('meta.next_cursor', null);
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-movements?filter[movement_type]=receipt&filter[date_to]=2027-06-30')->assertOk()->assertJsonCount(2, 'data');

    foreach (['stock-balances/export', 'stock-movements/export?format=xlsx', 'stock-documents/export'] as $uri) {
        Inv::as($this->user, $this->company)->get('/api/v1/'.$uri)->assertOk()->assertDownload();
    }
});

it('shows warehouses with their inventory policy and changes the reservation policy', function (): void {
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-warehouses')->assertOk()
        ->assertJsonPath('data.0.code', 'MAIN')->assertJsonPath('data.0.reservation_policy', 'soft')->assertJsonPath('data.0.allow_negative_stock', false);

    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-warehouses/{$this->wh->id}", ['reservation_policy' => 'hard', 'version' => 1])->assertOk()
        ->assertJsonPath('data.reservation_policy', 'hard')->assertJsonPath('data.version', 2);
    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-warehouses/{$this->wh->id}", ['reservation_policy' => 'none', 'version' => 1])->assertStatus(409);
    Inv::as($this->user, $this->company)->getJson("/api/v1/stock-warehouses/{$this->wh->id}")->assertOk()->assertJsonPath('data.has_movements', false);
});

it('posts once per source and purpose through the contract and replays API creates', function (): void {
    $source = (string) Str::uuid7();
    $line = [new StockPostingLine($this->item, '2', '5')];
    $first = Inv::post($this->company, DocumentType::Receipt, $this->wh->id, $line, source: $source);
    $second = Inv::post($this->company, DocumentType::Receipt, $this->wh->id, $line, source: $source);

    expect($second->documentId)->toBe($first->documentId)->and($second->replayed)->toBeTrue()
        ->and(Inv::onHand($this->company, $this->item, $this->wh->id))->toBe('2.000000');

    $key = (string) Str::uuid7();
    $body = ['doc_type' => 'receipt', 'document_date' => '2027-06-10', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $this->item, 'quantity' => '1', 'unit_cost' => '1']]];
    $a = Inv::as($this->user, $this->company)->postJson('/api/v1/stock-documents', $body, ['Idempotency-Key' => $key])->assertCreated();
    $b = Inv::as($this->user, $this->company)->postJson('/api/v1/stock-documents', $body, ['Idempotency-Key' => $key])->assertCreated();
    expect($b->json('data.id'))->toBe($a->json('data.id'))->and(DB::table('stock_documents')->where('status', 'draft')->count())->toBe(1);
});

it('reserves, refuses beyond availability under hard policy, consumes on issue and releases', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->item, '10', '1');
    $res = Inv::postJson($this->user, $this->company, 'stock-reservations', ['item_id' => $this->item, 'warehouse_id' => $this->wh->id, 'quantity' => '12'])
        ->assertCreated()->assertJsonPath('meta.shortage', '2.000000')->json('data');
    Inv::as($this->user, $this->company)->getJson("/api/v1/items/{$this->item}/stock")->assertJsonPath('data.available', '-2.000000');
    Inv::postJson($this->user, $this->company, "stock-reservations/{$res['id']}/release")->assertOk()->assertJsonPath('data.status', 'released');
    Inv::postJson($this->user, $this->company, "stock-reservations/{$res['id']}/release")->assertStatus(422);

    Inv::policy($this->company, $this->wh->id, 'hard');
    Inv::postJson($this->user, $this->company, 'stock-reservations', ['item_id' => $this->item, 'warehouse_id' => $this->wh->id, 'quantity' => '11'])->assertStatus(422);
    $held = Inv::postJson($this->user, $this->company, 'stock-reservations', ['item_id' => $this->item, 'warehouse_id' => $this->wh->id, 'quantity' => '8'])->assertCreated()->json('data');

    // Hard policy: an issue may not take the reserved stock...
    expect(fn () => Inv::issue($this->company, $this->wh->id, $this->item, '3'))->toThrow(ValidationException::class, 'reserved');
    // ...unless it consumes the reservation.
    Inv::issue($this->company, $this->wh->id, $this->item, '8', ['reservationId' => $held['id']]);
    expect(DB::table('stock_reservations')->where('id', $held['id'])->value('status'))->toBe('consumed')
        ->and(DB::table('stock_balances')->where('item_id', $this->item)->sum('reserved'))->toBe('0.000000');

    Inv::policy($this->company, $this->wh->id, 'none');
    Inv::postJson($this->user, $this->company, 'stock-reservations', ['item_id' => $this->item, 'warehouse_id' => $this->wh->id, 'quantity' => '1'])->assertStatus(422);
    Inv::as($this->user, $this->company)->getJson('/api/v1/stock-reservations?filter[status]=consumed')->assertOk()->assertJsonCount(1, 'data');
});

it('suggests reorders and notifies stock viewers from the scheduled check', function (): void {
    $low = Inv::item($this->company, ['code' => 'LOW', 'reorder_point' => '10', 'min_stock' => '5'])->id;
    Inv::item($this->company, ['code' => 'FINE', 'reorder_point' => '1']);
    Inv::receive($this->company, $this->wh->id, $low, '4', '1');

    Inv::as($this->user, $this->company)->getJson('/api/v1/reports/reorder-suggestions')->assertOk()
        ->assertJsonCount(2, 'data')->assertJsonPath('data.0.item_code', 'FINE')
        ->assertJsonPath('data.1.item_code', 'LOW')->assertJsonPath('data.1.suggested_quantity', '11.000000');

    Event::fake([StockBelowReorderPoint::class]);
    expect(Artisan::call('inventory:check-reorder', ['company' => $this->company]))->toBe(0);
    Event::assertDispatchedTimes(StockBelowReorderPoint::class, 2);
    expect(DB::table('notifications')->where('user_id', $this->user->id)->count())->toBe(1);
});

it('expires reservations whose hold time is over', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->item, '10', '1');
    Inv::postJson($this->user, $this->company, 'stock-reservations', ['item_id' => $this->item, 'warehouse_id' => $this->wh->id, 'quantity' => '3', 'expires_at' => '2027-06-15T12:00:00Z'])->assertCreated();

    Carbon::setTestNow('2027-06-16 10:00:00');
    expect(Artisan::call('inventory:expire-reservations', ['company' => $this->company]))->toBe(0)
        ->and(DB::table('stock_reservations')->value('status'))->toBe('expired')
        ->and(DB::table('stock_balances')->where('item_id', $this->item)->sum('reserved'))->toBe('0.000000');
});

it('seeds the inventory determination rules on company creation and on demand', function (): void {
    $events = DB::table('account_determination_rules')->where('company_id', $this->company)->where('event_key', 'like', 'inventory.%')->pluck('event_key')->sort()->values()->all();
    expect($events)->toBe(['inventory.adjustment_gain', 'inventory.adjustment_loss', 'inventory.cogs', 'inventory.opening_offset', 'inventory.scrap', 'inventory.stock']);

    expect(Artisan::call('inventory:seed-rules', ['company' => $this->company]))->toBe(0)
        ->and(DB::table('account_determination_rules')->where('company_id', $this->company)->where('event_key', 'like', 'inventory.%')->count())->toBe(6);
});

it('keeps an item with stock from being deleted', function (): void {
    Inv::receive($this->company, $this->wh->id, $this->item, '1', '1');

    expect(Inv::in($this->company, fn (): bool => app(ItemUsageChecker::class)->isUsed($this->item)))->toBeTrue();
});
