<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->manager = Actors::user(['discount_rules.manage']);
    $this->pricer = Actors::user(['pricing.view']);
    $this->other = Actors::company();
    $this->pcs = Catalog::unit($this->company, 'PCS');
    $this->item = Catalog::item($this->company, $this->pcs);
    $this->category = Catalog::category($this->company, 'CAT');
});

it('validates discount rule scopes, references and ranges', function (): void {
    $rule = fn (array $data) => Catalog::post($this->manager, $this->company, 'discount-rules', ['code' => 'R'.Str::random(5), 'name' => 'Rule', 'discount_percent' => '10', ...$data]);

    $rule(['scope' => 'item'])->assertStatus(422)->assertJsonValidationErrors(['scope_ref'], 'errors.fields');
    $rule(['scope' => 'item', 'scope_ref' => (string) Str::uuid7()])->assertStatus(422)->assertJsonValidationErrors(['scope_ref'], 'errors.fields');
    $rule(['scope' => 'category', 'scope_ref' => $this->item->id])->assertStatus(422)->assertJsonValidationErrors(['scope_ref'], 'errors.fields');
    $rule(['scope' => 'all', 'scope_ref' => $this->item->id])->assertStatus(422)->assertJsonValidationErrors(['scope_ref'], 'errors.fields');
    $rule(['scope' => 'party'])->assertStatus(422)->assertJsonValidationErrors(['party_id'], 'errors.fields');
    $rule(['scope' => 'all', 'discount_percent' => '0'])->assertStatus(422)->assertJsonValidationErrors(['discount_percent'], 'errors.fields');
    $rule(['scope' => 'all', 'discount_percent' => '100.0001'])->assertStatus(422)->assertJsonValidationErrors(['discount_percent'], 'errors.fields');
    $rule(['scope' => 'all', 'valid_from' => '2026-02-01', 'valid_to' => '2026-01-01'])->assertStatus(422)->assertJsonValidationErrors(['valid_to'], 'errors.fields');
    $rule(['scope' => 'gold'])->assertStatus(422)->assertJsonValidationErrors(['scope'], 'errors.fields');

    $foreignItem = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'));
    $rule(['scope' => 'item', 'scope_ref' => $foreignItem->id])->assertStatus(422);

    $id = $rule(['scope' => 'category', 'scope_ref' => $this->category->id, 'discount_percent' => '12.5', 'stackable' => true, 'priority' => 3])
        ->assertCreated()->assertJsonPath('data.discount_percent', '12.5000')->assertJsonPath('data.min_qty', '0.000000')->json('data.id');
    $rule(['scope' => 'party', 'party_id' => (string) Str::uuid7()])->assertCreated();

    Catalog::as($this->manager, $this->company)->patchJson("/api/v1/discount-rules/{$id}", ['scope' => 'all', 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['scope_ref'], 'errors.fields');
    Catalog::as($this->manager, $this->company)->patchJson("/api/v1/discount-rules/{$id}", ['scope' => 'all', 'scope_ref' => null, 'version' => 1])
        ->assertOk()->assertJsonPath('data.scope', 'all');
    Catalog::as($this->pricer, $this->company)->getJson('/api/v1/discount-rules?filter[scope]=all')->assertOk()->assertJsonCount(1, 'data');
    Catalog::as($this->pricer, $this->company)->patchJson("/api/v1/discount-rules/{$id}", ['name' => 'x', 'version' => 2])->assertStatus(403);
    Catalog::as($this->manager, $this->company)->deleteJson("/api/v1/discount-rules/{$id}")->assertNoContent();
});

it('resolves prices over HTTP with defaults for unit, qty and date', function (): void {
    $list = Catalog::priceList($this->company, ['is_default' => true, 'tax_inclusive' => true]);
    Catalog::line($this->company, $list, $this->item, $this->pcs, '50');

    Catalog::as($this->pricer, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$this->item->id}&currency=TRY")
        ->assertOk()
        ->assertJsonPath('data.unit_price', '50.000000')
        ->assertJsonPath('data.qty', '1')
        ->assertJsonPath('data.unit_id', $this->pcs->id)
        ->assertJsonPath('data.price_list_id', $list->id)
        ->assertJsonPath('data.tax_inclusive', true)
        ->assertJsonPath('data.source', 'default_price_list')
        ->assertJsonPath('data.date', now('UTC')->toDateString());

    Catalog::as($this->pricer, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$this->item->id}&currency=TRY&date=2026-01-15&qty=2.5")
        ->assertOk()->assertJsonPath('data.date', '2026-01-15')->assertJsonPath('data.qty', '2.5');
    Catalog::as($this->pricer, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$this->item->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['currency'], 'errors.fields');
    Catalog::as($this->pricer, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$this->item->id}&currency=TRY&qty=0")
        ->assertStatus(422)->assertJsonValidationErrors(['qty'], 'errors.fields');
    Catalog::as($this->manager, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$this->item->id}&currency=TRY")->assertStatus(403);

    $foreign = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'));
    Catalog::as($this->pricer, $this->company)->getJson("/api/v1/pricing/resolve?item_id={$foreign->id}&currency=TRY")->assertNotFound();
});
