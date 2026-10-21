<?php

declare(strict_types=1);

use App\Modules\Identity\Services\PermissionCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Actors;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world();
    $this->order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '3', '100']]);
    $this->delivery = SalesKit::deliver($this->w, $this->order['id'], [$this->order['lines'][0]['id'] => '2']);
    $this->invoice = SalesKit::invoiceDelivery($this->w, $this->delivery['id']);
    $this->quote = SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '10']],
    ])->json('data');
    $this->return = SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $this->invoice['lines'][0]['id'], 'quantity' => '1']],
    ])->json('data');
});

/**
 * [method, uri, permission that alone grants it (after the record checks)].
 *
 * @return list<array{0: string, 1: string, 2: string|list<string>}>
 */
function salesEndpoints(object $t): array
{
    [$q, $o, $d, $i, $r] = [$t->quote['id'], $t->order['id'], $t->delivery['id'], $t->invoice['id'], $t->return['id']];

    return [
        ['get', 'sales-quotes', 'sales.quotes.view'], ['get', "sales-quotes/{$q}", 'sales.quotes.view'], ['get', 'sales-quotes/export', 'sales.quotes.view'],
        ['get', "sales-quotes/{$q}/print-model", 'sales.quotes.view'], ['post', 'sales-quotes', 'sales.quotes.create'],
        ['patch', "sales-quotes/{$q}", 'sales.quotes.update'], ['delete', "sales-quotes/{$q}", 'sales.quotes.delete'],
        ['post', "sales-quotes/{$q}/send", 'sales.quotes.update'], ['post', "sales-quotes/{$q}/accept", 'sales.quotes.update'],
        ['post', "sales-quotes/{$q}/reject", 'sales.quotes.update'], ['post', "sales-quotes/{$q}/cancel", 'sales.quotes.update'],
        ['post', "sales-quotes/{$q}/revise", 'sales.quotes.update'], ['post', "sales-quotes/{$q}/convert", ['sales.quotes.update', 'sales.orders.create']],
        ['get', 'sales-orders', 'sales.orders.view'], ['get', "sales-orders/{$o}", 'sales.orders.view'], ['post', 'sales-orders', 'sales.orders.create'],
        ['patch', "sales-orders/{$o}", 'sales.orders.update'], ['delete', "sales-orders/{$o}", 'sales.orders.delete'],
        ['post', "sales-orders/{$o}/confirm", 'sales.orders.approve'], ['post', "sales-orders/{$o}/revise", 'sales.orders.approve'],
        ['post', "sales-orders/{$o}/cancel", 'sales.orders.update'], ['post', "sales-orders/{$o}/close", 'sales.orders.approve'],
        ['post', "sales-orders/{$o}/deliveries", ['sales.deliveries.create', 'sales.orders.view']], ['post', "sales-orders/{$o}/invoices", ['sales.invoices.create', 'sales.orders.view']],
        ['get', 'sales-deliveries', 'sales.deliveries.view'], ['get', "sales-deliveries/{$d}", 'sales.deliveries.view'], ['post', 'sales-deliveries', 'sales.deliveries.create'],
        ['patch', "sales-deliveries/{$d}", 'sales.deliveries.update'], ['delete', "sales-deliveries/{$d}", 'sales.deliveries.delete'],
        ['post', "sales-deliveries/{$d}/post", 'sales.deliveries.post'], ['post', "sales-deliveries/{$d}/cancel", 'sales.deliveries.reverse'],
        ['post', "sales-deliveries/{$d}/invoice", ['sales.invoices.create', 'sales.deliveries.view']],
        ['get', 'sales-invoices', 'sales.invoices.view'], ['get', "sales-invoices/{$i}", 'sales.invoices.view'], ['post', 'sales-invoices', 'sales.invoices.create'],
        ['patch', "sales-invoices/{$i}", 'sales.invoices.update'], ['delete', "sales-invoices/{$i}", 'sales.invoices.delete'],
        ['post', "sales-invoices/{$i}/issue", 'sales.invoices.issue'], ['post', "sales-invoices/{$i}/reverse", 'sales.invoices.reverse'],
        ['post', "sales-invoices/{$i}/cancel", 'sales.invoices.update'], ['post', "sales-invoices/{$i}/returns", ['sales.returns.create', 'sales.invoices.view']],
        ['get', 'sales-returns', 'sales.returns.view'], ['get', "sales-returns/{$r}", 'sales.returns.view'],
        ['patch', "sales-returns/{$r}", 'sales.returns.update'], ['delete', "sales-returns/{$r}", 'sales.returns.delete'],
        ['post', "sales-returns/{$r}/approve", 'sales.returns.approve'], ['post', "sales-returns/{$r}/receive", 'sales.returns.receive'],
        ['post', "sales-returns/{$r}/credit", 'sales.returns.credit'], ['post', "sales-returns/{$r}/cancel", 'sales.returns.update'],
        ['post', 'sales-documents/preview-totals', 'sales.quotes.create'],
        ['get', "customers/{$t->w->party->id}/exposure", 'sales.orders.view'], ['get', "customers/{$t->w->party->id}/sales-summary", 'sales.invoices.view'],
    ];
}

function callSales(object $t, mixed $user, string $method, string $uri, ?string $company = null): TestResponse
{
    $client = SalesKit::as($user, $company ?? $t->w->company);

    return match ($method) {
        'get' => $client->getJson('/api/v1/'.$uri),
        'post' => $client->postJson('/api/v1/'.$uri, ['version' => 1], ['Idempotency-Key' => (string) Str::uuid7()]),
        'patch' => $client->patchJson('/api/v1/'.$uri, ['version' => 1]),
        'delete' => $client->deleteJson('/api/v1/'.$uri),
    };
}

it('refuses every endpoint without its permission and passes the permission gate with it', function (): void {
    $nobody = Actors::user(['parties.view']);

    foreach (salesEndpoints($this) as [$method, $uri, $permission]) {
        callSales($this, $nobody, $method, $uri)->assertForbidden();
        $holder = Actors::user((array) $permission);
        $status = callSales($this, $holder, $method, $uri)->getStatusCode();
        expect($status)->not->toBe(403, "{$method} {$uri}");

        if (is_array($permission)) {
            callSales($this, Actors::user([$permission[0]]), $method, $uri)->assertForbidden();
        }
    }
});

it('hides other companies documents (404) and refuses their parties, items and source lines', function (): void {
    $other = Actors::companyFor($this->w->user, SalesKit::ALL);

    foreach (salesEndpoints($this) as [$method, $uri]) {
        if (str_contains($uri, '/') && preg_match('/[0-9a-f-]{36}/', $uri) === 1) {
            $status = callSales($this, $this->w->user, $method, $uri, $other)->getStatusCode();
            expect($status)->toBe(404, "{$method} {$uri}");
        }
    }

    $client = SalesKit::post($this->w->user, $other, 'sales-quotes', [
        'party_id' => $this->w->party->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['party_id']));

    $foreignParty = SalesKit::party($other);
    SalesKit::post($this->w->user, $other, 'sales-quotes', [
        'party_id' => $foreignParty->id, 'lines' => [['item_id' => $this->w->service->id, 'quantity' => '1', 'unit_price' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.item_id']));

    // Source lines of another company cannot be invoiced or returned.
    SalesKit::post($this->w->user, $other, 'sales-invoices', [
        'party_id' => $foreignParty->id, 'lines' => [['delivery_line_id' => $this->delivery['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422);
    expect(DB::table('sales_invoices')->where('company_id', $other)->count())->toBe(0);
    SalesKit::get($this->w->user, $other, 'sales-invoices')->assertOk()->assertJsonPath('meta.pagination.total', 0);
});

it('refuses source lines of another customer in the same company', function (): void {
    $stranger = SalesKit::party($this->w->company);
    SalesKit::post($this->w->user, $this->w->company, 'sales-invoices', [
        'party_id' => $stranger->id, 'lines' => [['order_line_id' => $this->order['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['lines.0.order_line_id']));
    SalesKit::post($this->w->user, $this->w->company, "sales-invoices/{$this->invoice['id']}/returns", [
        'lines' => [['invoice_line_id' => $this->order['lines'][0]['id'], 'quantity' => '1']],
    ])->assertStatus(422);
});

it('cancelling a posted delivery needs sales.deliveries.reverse', function (): void {
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '100']]);
    $delivery = SalesKit::deliver($this->w, $order['id'], [$order['lines'][0]['id'] => '1']);
    $clerk = Actors::user(['sales.deliveries.view', 'sales.deliveries.update']);
    SalesKit::post($clerk, $this->w->company, "sales-deliveries/{$delivery['id']}/cancel", ['reason' => 'x'])->assertForbidden();
    SalesKit::post(Actors::user(['sales.deliveries.reverse']), $this->w->company, "sales-deliveries/{$delivery['id']}/cancel", ['reason' => 'x'])->assertOk();
});

it('declares the permissions with default roles', function (): void {
    $catalog = app(PermissionCatalog::class);
    $names = DB::table('permissions')->where('name', 'like', 'sales.%')->pluck('name')->all();

    expect($names)->toContain('sales.invoices.issue', 'sales.price_override', 'sales.credit_override', 'sales.reports.view', 'sales.returns.credit');
    $sales = DB::table('roles')->where('company_id', $this->w->company)->where('name', 'Sales')->value('id');
    $granted = DB::table('role_has_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->where('rp.role_id', $sales)->pluck('p.name')->all();
    expect($granted)->toContain('sales.orders.approve', 'sales.quotes.create')->not->toContain('sales.invoices.issue', 'sales.credit_override')
        ->and($catalog)->not->toBeNull();
});
