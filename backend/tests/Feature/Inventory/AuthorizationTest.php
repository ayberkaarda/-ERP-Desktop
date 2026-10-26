<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company);
    $this->item = Inv::item($this->company)->id;
    $this->posted = Inv::receive($this->company, $this->wh->id, $this->item, '5', '2');
    $this->reservation = DB::table('stock_reservations')->insertGetId([
        'id' => (string) Str::uuid7(), 'company_id' => $this->company, 'item_id' => $this->item, 'warehouse_id' => $this->wh->id,
        'quantity' => '1', 'status' => 'active', 'version' => 1, 'created_at' => now(), 'updated_at' => now(),
    ], 'id');
});

it('answers 403 without the permission on every endpoint', function (string $method, string $uri, array $allowed): void {
    $uri = str_replace(['{doc}', '{wh}', '{item}', '{res}'], [$this->posted->documentId, $this->wh->id, $this->item, $this->reservation], $uri);
    $others = array_values(array_diff(Inv::ALL, $allowed));
    $user = Actors::user($others);
    $headers = ['Idempotency-Key' => (string) Str::uuid7()];

    Inv::as($user, $this->company)->json($method, '/api/v1/'.$uri, [], $headers)->assertForbidden();
})->with([
    'warehouses list' => ['GET', 'stock-warehouses', ['inventory.warehouses.view', 'inventory.warehouses.manage', 'inventory.stock.view', 'inventory.documents.view', 'inventory.reservations.manage']],
    'warehouse policy' => ['PATCH', 'stock-warehouses/{wh}', ['inventory.warehouses.manage']],
    'documents list' => ['GET', 'stock-documents', ['inventory.documents.view']],
    'document show' => ['GET', 'stock-documents/{doc}', ['inventory.documents.view']],
    'documents export' => ['GET', 'stock-documents/export', ['inventory.documents.view']],
    'document create' => ['POST', 'stock-documents', ['inventory.documents.create']],
    'document update' => ['PATCH', 'stock-documents/{doc}', ['inventory.documents.create']],
    'document delete' => ['DELETE', 'stock-documents/{doc}', ['inventory.documents.create']],
    'document counts' => ['PATCH', 'stock-documents/{doc}/counts', ['inventory.documents.create']],
    'document import' => ['POST', 'stock-documents/{doc}/import', ['inventory.documents.create']],
    'document post' => ['POST', 'stock-documents/{doc}/post', ['inventory.documents.post']],
    'document reverse' => ['POST', 'stock-documents/{doc}/reverse', ['inventory.documents.reverse']],
    'balances' => ['GET', 'stock-balances', ['inventory.stock.view']],
    'balances export' => ['GET', 'stock-balances/export', ['inventory.stock.view']],
    'item stock' => ['GET', 'items/{item}/stock', ['inventory.stock.view']],
    'movements' => ['GET', 'stock-movements', ['inventory.stock.view']],
    'movements export' => ['GET', 'stock-movements/export', ['inventory.stock.view']],
    'lots' => ['GET', 'stock-lots', ['inventory.stock.view']],
    'serials' => ['GET', 'stock-serials', ['inventory.stock.view']],
    'reservations list' => ['GET', 'stock-reservations', ['inventory.reservations.manage', 'inventory.stock.view']],
    'reservation create' => ['POST', 'stock-reservations', ['inventory.reservations.manage']],
    'reservation release' => ['POST', 'stock-reservations/{res}/release', ['inventory.reservations.manage']],
    'reorder' => ['GET', 'reports/reorder-suggestions', ['inventory.stock.view']],
]);

it('lets stock and document viewers and reservation managers read warehouses for pickers but not change them', function (string $permission): void {
    $user = Actors::user([$permission]);

    Inv::as($user, $this->company)->getJson('/api/v1/stock-warehouses')->assertOk()->assertJsonCount(1, 'data');
    Inv::as($user, $this->company)->getJson("/api/v1/stock-warehouses/{$this->wh->id}")->assertOk();
    Inv::as($user, $this->company)->patchJson("/api/v1/stock-warehouses/{$this->wh->id}", ['reservation_policy' => 'hard', 'version' => 1])->assertForbidden();
})->with(['inventory.stock.view', 'inventory.documents.view', 'inventory.reservations.manage']);

it('isolates companies', function (): void {
    $user = Actors::user(Inv::ALL);
    $other = Actors::companyFor($user, Inv::ALL);
    $foreignWh = Inv::warehouse($other, 'FOREIGN');
    $foreignItem = Inv::item($other)->id;
    $foreign = Inv::receive($other, $foreignWh->id, $foreignItem, '9', '1');

    Inv::as($user, $this->company)->getJson("/api/v1/stock-documents/{$foreign->documentId}")->assertNotFound();
    Inv::postJson($user, $this->company, "stock-documents/{$foreign->documentId}/post")->assertNotFound();
    Inv::postJson($user, $this->company, "stock-documents/{$foreign->documentId}/reverse", ['date' => '2027-06-12', 'reason' => 'x'])->assertNotFound();
    Inv::as($user, $this->company)->getJson("/api/v1/items/{$foreignItem}/stock")->assertNotFound();
    Inv::as($user, $this->company)->getJson("/api/v1/stock-warehouses/{$foreignWh->id}")->assertNotFound();
    Inv::as($user, $this->company)->getJson('/api/v1/stock-balances')->assertOk()->assertJsonCount(1, 'data');
    Inv::as($user, $this->company)->getJson('/api/v1/stock-movements')->assertOk()->assertJsonCount(1, 'data');
    Inv::as($user, $this->company)->getJson('/api/v1/stock-documents')->assertOk()->assertJsonCount(1, 'data');

    // Foreign warehouses and items cannot be used in documents.
    Inv::postJson($user, $this->company, 'stock-documents', [
        'doc_type' => 'receipt', 'document_date' => '2027-06-10', 'warehouse_id' => $foreignWh->id, 'lines' => [['item_id' => $this->item, 'quantity' => '1']],
    ])->assertStatus(422);
    Inv::postJson($user, $this->company, 'stock-documents', [
        'doc_type' => 'receipt', 'document_date' => '2027-06-10', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $foreignItem, 'quantity' => '1']],
    ])->assertStatus(422);
    Inv::postJson($user, $this->company, 'stock-reservations', ['item_id' => $foreignItem, 'warehouse_id' => $this->wh->id, 'quantity' => '1'])->assertStatus(422);
});
