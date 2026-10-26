<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->order = PurchKit::approvedOrder($this->w, [[$this->w->item->id, '3', '100']]);
    $this->receipt = PurchKit::receive($this->w, $this->order['id'], [$this->order['lines'][0]['id'] => '2']);
    $this->invoice = PurchKit::invoiceReceipt($this->w, $this->receipt['id'], 'AUTH-1');
    $this->request = PurchKit::post($this->w->user, $this->w->company, 'purchase-requests', [
        'lines' => [['item_id' => $this->w->item->id, 'quantity' => '1', 'estimated_price' => '10']],
    ])->json('data');
    $this->rfq = PurchKit::post($this->w->user, $this->w->company, 'purchase-rfqs', [
        'supplier_ids' => [$this->w->party->id], 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '1']],
    ])->json('data');
    $this->return = PurchKit::post($this->w->user, $this->w->company, "purchase-invoices/{$this->invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $this->invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->json('data');
});

/**
 * [method, uri, permission that alone grants it (after the record checks)].
 *
 * @return list<array{0: string, 1: string, 2: string|list<string>}>
 */
function purchEndpoints(object $t): array
{
    [$q, $f, $o, $r, $i, $x] = [$t->request['id'], $t->rfq['id'], $t->order['id'], $t->receipt['id'], $t->invoice['id'], $t->return['id']];
    $party = $t->w->party->id;

    return [
        ['get', 'purchase-requests', 'purchasing.requests.view'], ['get', "purchase-requests/{$q}", 'purchasing.requests.view'],
        ['get', 'purchase-requests/export', 'purchasing.requests.view'], ['post', 'purchase-requests', 'purchasing.requests.create'],
        ['patch', "purchase-requests/{$q}", 'purchasing.requests.update'], ['delete', "purchase-requests/{$q}", 'purchasing.requests.delete'],
        ['post', "purchase-requests/{$q}/submit", 'purchasing.requests.update'], ['post', "purchase-requests/{$q}/cancel", 'purchasing.requests.update'],
        ['post', "purchase-requests/{$q}/rfq", ['purchasing.rfqs.create', 'purchasing.requests.view']],
        ['post', "purchase-requests/{$q}/orders", ['purchasing.orders.create', 'purchasing.requests.view']],
        ['get', 'purchase-rfqs', 'purchasing.rfqs.view'], ['get', "purchase-rfqs/{$f}", 'purchasing.rfqs.view'], ['get', 'purchase-rfqs/export', 'purchasing.rfqs.view'],
        ['post', 'purchase-rfqs', 'purchasing.rfqs.create'], ['patch', "purchase-rfqs/{$f}", 'purchasing.rfqs.update'],
        ['delete', "purchase-rfqs/{$f}", 'purchasing.rfqs.delete'], ['post', "purchase-rfqs/{$f}/send", 'purchasing.rfqs.update'],
        ['post', "purchase-rfqs/{$f}/cancel", 'purchasing.rfqs.update'], ['post', "purchase-rfqs/{$f}/quotes", 'purchasing.rfqs.update'],
        ['get', "purchase-rfqs/{$f}/comparison", 'purchasing.rfqs.view'], ['post', "purchase-rfqs/{$f}/award", ['purchasing.rfqs.award', 'purchasing.orders.create']],
        ['get', 'purchase-orders', 'purchasing.orders.view'], ['get', "purchase-orders/{$o}", 'purchasing.orders.view'], ['get', 'purchase-orders/export', 'purchasing.orders.view'],
        ['get', "purchase-orders/{$o}/print-model", 'purchasing.orders.view'], ['post', 'purchase-orders', 'purchasing.orders.create'],
        ['patch', "purchase-orders/{$o}", 'purchasing.orders.update'], ['delete', "purchase-orders/{$o}", 'purchasing.orders.delete'],
        ['post', "purchase-orders/{$o}/submit", 'purchasing.orders.approve'], ['post', "purchase-orders/{$o}/revise", 'purchasing.orders.approve'],
        ['post', "purchase-orders/{$o}/send", 'purchasing.orders.update'], ['post', "purchase-orders/{$o}/cancel", 'purchasing.orders.update'],
        ['post', "purchase-orders/{$o}/close", 'purchasing.orders.approve'],
        ['post', "purchase-orders/{$o}/receipts", ['purchasing.receipts.create', 'purchasing.orders.view']],
        ['post', "purchase-orders/{$o}/invoices", ['purchasing.invoices.create', 'purchasing.orders.view']],
        ['get', 'purchase-receipts', 'purchasing.receipts.view'], ['get', "purchase-receipts/{$r}", 'purchasing.receipts.view'],
        ['get', "purchase-receipts/{$r}/print-model", 'purchasing.receipts.view'], ['post', 'purchase-receipts', 'purchasing.receipts.create'],
        ['patch', "purchase-receipts/{$r}", 'purchasing.receipts.update'], ['delete', "purchase-receipts/{$r}", 'purchasing.receipts.delete'],
        ['post', "purchase-receipts/{$r}/post", 'purchasing.receipts.post'], ['post', "purchase-receipts/{$r}/cancel", 'purchasing.receipts.reverse'],
        ['post', "purchase-receipts/{$r}/invoice", ['purchasing.invoices.create', 'purchasing.receipts.view']],
        ['post', "purchase-receipts/{$r}/returns", ['purchasing.returns.create', 'purchasing.receipts.view']],
        ['get', 'purchase-invoices', 'purchasing.invoices.view'], ['get', "purchase-invoices/{$i}", 'purchasing.invoices.view'],
        ['get', "purchase-invoices/{$i}/match", 'purchasing.invoices.view'], ['post', 'purchase-invoices', 'purchasing.invoices.create'],
        ['patch', "purchase-invoices/{$i}", 'purchasing.invoices.update'], ['delete', "purchase-invoices/{$i}", 'purchasing.invoices.delete'],
        ['post', "purchase-invoices/{$i}/book", 'purchasing.invoices.book'], ['post', "purchase-invoices/{$i}/reverse", 'purchasing.invoices.reverse'],
        ['post', "purchase-invoices/{$i}/cancel", 'purchasing.invoices.update'],
        ['post', "purchase-invoices/{$i}/returns", ['purchasing.returns.create', 'purchasing.invoices.view']],
        ['get', 'purchase-returns', 'purchasing.returns.view'], ['get', "purchase-returns/{$x}", 'purchasing.returns.view'],
        ['patch', "purchase-returns/{$x}", 'purchasing.returns.update'], ['delete', "purchase-returns/{$x}", 'purchasing.returns.delete'],
        ['post', "purchase-returns/{$x}/approve", 'purchasing.returns.approve'], ['post', "purchase-returns/{$x}/ship", 'purchasing.returns.ship'],
        ['post', "purchase-returns/{$x}/debit", 'purchasing.returns.debit'], ['post', "purchase-returns/{$x}/cancel", 'purchasing.returns.update'],
        ['post', 'purchase-documents/preview-totals', 'purchasing.orders.create'],
        ['get', "suppliers/{$party}/exposure", 'purchasing.orders.view'], ['get', "suppliers/{$party}/purchase-summary", 'purchasing.invoices.view'],
        ['get', "suppliers/{$party}/performance", 'purchasing.orders.view'],
    ];
}

function callPurch(object $t, mixed $user, string $method, string $uri, ?string $company = null): TestResponse
{
    $client = PurchKit::as($user, $company ?? $t->w->company);

    return match ($method) {
        'get' => $client->getJson('/api/v1/'.$uri),
        'post' => $client->postJson('/api/v1/'.$uri, ['version' => 1], ['Idempotency-Key' => (string) Str::uuid7()]),
        'patch' => $client->patchJson('/api/v1/'.$uri, ['version' => 1]),
        'delete' => $client->deleteJson('/api/v1/'.$uri),
    };
}

it('refuses every endpoint without its permission and passes the permission gate with it', function (): void {
    $nobody = Actors::user(['parties.view']);

    foreach (purchEndpoints($this) as [$method, $uri, $permission]) {
        callPurch($this, $nobody, $method, $uri)->assertForbidden();
        $holder = Actors::user((array) $permission);
        $status = callPurch($this, $holder, $method, $uri)->getStatusCode();
        expect($status)->not->toBe(403, "{$method} {$uri}");

        if (is_array($permission)) {
            callPurch($this, Actors::user([$permission[0]]), $method, $uri)->assertForbidden();
        }
    }
});

it('hides other companies documents (404) and refuses their suppliers, items and source lines', function (): void {
    $other = Actors::companyFor($this->w->user, PurchKit::ALL);

    foreach (purchEndpoints($this) as [$method, $uri]) {
        if (str_contains($uri, '/') && preg_match('/[0-9a-f-]{36}/', $uri) === 1) {
            $status = callPurch($this, $this->w->user, $method, $uri, $other)->getStatusCode();
            expect($status)->toBe(404, "{$method} {$uri}");
        }
    }

    PurchKit::post($this->w->user, $other, 'purchase-orders', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['party_id']));

    $foreignSupplier = PurchKit::supplier($other);
    PurchKit::post($this->w->user, $other, 'purchase-orders', [
        'party_id' => $foreignSupplier->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.item_id']));

    // Source lines of another company cannot be invoiced.
    PurchKit::post($this->w->user, $other, 'purchase-invoices', [
        'party_id' => $foreignSupplier->id, 'supplier_invoice_no' => 'X', 'lines' => [['receipt_line_id' => $this->receipt['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422);
    expect(DB::table('purchase_invoices')->where('company_id', $other)->count())->toBe(0);
    PurchKit::get($this->w->user, $other, 'purchase-invoices')->assertOk()->assertJsonPath('meta.pagination.total', 0);
});

it('refuses source lines of another supplier in the same company', function (): void {
    $stranger = PurchKit::supplier($this->w->company);
    PurchKit::post($this->w->user, $this->w->company, 'purchase-invoices', [
        'party_id' => $stranger->id, 'supplier_invoice_no' => 'S-1', 'lines' => [['receipt_line_id' => $this->receipt['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.receipt_line_id']));
    PurchKit::post($this->w->user, $this->w->company, 'purchase-invoices', [
        'party_id' => $stranger->id, 'supplier_invoice_no' => 'S-2', 'lines' => [['order_line_id' => $this->order['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.order_line_id']));
});

it('needs view on the sources a direct invoice copies', function (): void {
    $clerk = Actors::user(['purchasing.invoices.create']);
    PurchKit::post($clerk, $this->w->company, 'purchase-invoices', [
        'party_id' => $this->w->party->id, 'supplier_invoice_no' => 'V-1', 'lines' => [['receipt_line_id' => $this->receipt['lines'][0]['id'], 'quantity' => '1']],
    ])->assertForbidden();
});

it('declares the permissions with default roles', function (): void {
    $names = DB::table('permissions')->where('name', 'like', 'purchasing.%')->pluck('name')->all();
    expect($names)->toContain('purchasing.invoices.book', 'purchasing.match_override', 'purchasing.price_override', 'purchasing.reports.view', 'purchasing.rfqs.award');

    $role = DB::table('roles')->where('company_id', $this->w->company)->where('name', 'Purchasing')->value('id');
    $granted = DB::table('role_has_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('rp.role_id', $role)->pluck('p.name')->all();
    expect($granted)->toContain('purchasing.orders.approve', 'purchasing.rfqs.award', 'purchasing.requests.create')
        ->not->toContain('purchasing.invoices.book', 'purchasing.match_override', 'purchasing.price_override');
    $accountant = DB::table('roles')->where('company_id', $this->w->company)->where('name', 'Accountant')->value('id');
    $granted = DB::table('role_has_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('rp.role_id', $accountant)->pluck('p.name')->all();
    expect($granted)->toContain('purchasing.invoices.book', 'purchasing.invoices.reverse', 'purchasing.returns.debit');
});
