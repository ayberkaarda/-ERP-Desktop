<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->pcs = Catalog::unit($this->company, 'PCS');
    $this->item = Catalog::item($this->company, $this->pcs);
    $this->list = Catalog::priceList($this->company);
    $this->category = Catalog::category($this->company, 'CAT');
});

dataset('catalog endpoints', [
    'units' => ['get', 'units', ['units.manage', 'items.view']],
    'unit conversions' => ['get', 'unit-conversions', ['units.manage', 'items.view']],
    'categories' => ['get', 'item-categories', ['item_categories.manage', 'items.view']],
    'items' => ['get', 'items', ['items.view']],
    'item variants' => ['get', 'items/{item}/variants', ['items.view']],
    'item barcodes' => ['get', 'items/{item}/barcodes', ['items.view']],
    'item units' => ['get', 'items/{item}/units', ['items.view']],
    'price lists' => ['get', 'price-lists', ['price_lists.view']],
    'price list lines' => ['get', 'price-lists/{list}/lines', ['price_lists.view']],
    'discount rules' => ['get', 'discount-rules', ['discount_rules.manage', 'pricing.view']],
    'pricing' => ['get', 'pricing/resolve?item_id={item}&currency=TRY', ['pricing.view']],
    'create unit' => ['post', 'units', ['units.manage']],
    'create conversion' => ['post', 'unit-conversions', ['units.manage']],
    'create category' => ['post', 'item-categories', ['item_categories.manage']],
    'create item' => ['post', 'items', ['items.create']],
    'create variant' => ['post', 'items/{item}/variants', ['items.update']],
    'create price list' => ['post', 'price-lists', ['price_lists.create']],
    'bulk lines' => ['put', 'price-lists/{list}/lines', ['price_lists.update']],
    'create discount rule' => ['post', 'discount-rules', ['discount_rules.manage']],
]);

it('lets exactly the listed permissions through', function (string $method, string $uri, array $allowed): void {
    $uri = '/api/v1/'.strtr($uri, ['{item}' => $this->item->id, '{list}' => $this->list->id]);
    $call = fn ($user) => Catalog::as($user, $this->company)->json(strtoupper($method), $uri, [], ['Idempotency-Key' => (string) Str::uuid7()]);

    // Every catalog permission except the allowed ones is not enough.
    $others = array_values(array_diff(Catalog::ALL, $allowed));
    $call(Actors::user($others))->assertStatus(403);

    foreach ($allowed as $permission) {
        // Validation (422) or success both prove the request got past authorization.
        expect($call(Actors::user([$permission]))->status())->toBeIn([200, 201, 422]);
    }
})->with('catalog endpoints');

it('requires a company the user belongs to', function (): void {
    $user = Actors::user(Catalog::ALL);
    $foreign = Actors::company();

    Auth::forgetGuards();
    $this->actingAs($user, 'web')->getJson('/api/v1/items')->assertStatus(400)->assertJsonPath('errors.code', 'COMPANY_REQUIRED');
    Catalog::as($user, $foreign)->getJson('/api/v1/items')->assertStatus(403);
    Auth::forgetGuards();
    $this->withHeaders(['X-Company-Id' => $this->company])->getJson('/api/v1/items')->assertStatus(401);
});

it('lets super admins through without roles', function (): void {
    $root = User::factory()->superAdmin()->create();
    Catalog::as($root, $this->company)->getJson('/api/v1/items')->assertOk();
});
