<?php

declare(strict_types=1);

use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\PriceListLine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->manager = Actors::user(['price_lists.view', 'price_lists.create', 'price_lists.update', 'price_lists.delete']);
    $this->viewer = Actors::user(['price_lists.view']);
    $this->other = Actors::company();
    $this->pcs = Catalog::unit($this->company, 'PCS');
    $this->box = Catalog::unit($this->company, 'BOX');
    $this->kg = Catalog::unit($this->company, 'KG');
    $this->item = Catalog::item($this->company, $this->pcs);
    Catalog::itemUnit($this->company, $this->item, $this->box, '12');
    $this->variant = Catalog::variant($this->company, $this->item, 'V-1');
    $this->list = Catalog::priceList($this->company, ['code' => 'RETAIL']);
    $this->put = fn (array $lines, $user = null) => Catalog::as($user ?? $this->manager, $this->company)
        ->putJson("/api/v1/price-lists/{$this->list->id}/lines", ['lines' => $lines]);
    $this->lines = fn (): int => Catalog::in($this->company, fn () => PriceListLine::query()->where('price_list_id', $this->list->id)->count());
});

it('manages price lists and keeps one default per currency', function (): void {
    $first = Catalog::post($this->manager, $this->company, 'price-lists', [
        'code' => 'TRY-A', 'name' => 'A', 'currency_code' => 'TRY', 'is_default' => true, 'tax_inclusive' => true,
        'valid_from' => '2026-01-01', 'valid_to' => '2026-12-31',
    ])->assertCreated()->assertJsonPath('data.tax_inclusive', true)->assertJsonPath('data.valid_to', '2026-12-31')->json('data.id');
    $usd = Catalog::post($this->manager, $this->company, 'price-lists', ['code' => 'USD-A', 'name' => 'U', 'currency_code' => 'USD', 'is_default' => true])
        ->assertCreated()->json('data.id');
    $second = Catalog::post($this->manager, $this->company, 'price-lists', ['code' => 'TRY-B', 'name' => 'B', 'currency_code' => 'TRY', 'is_default' => true])
        ->assertCreated()->json('data.id');

    $defaults = Catalog::in($this->company, fn () => PriceList::query()->where('is_default', true)->orderBy('code')->pluck('id')->all());
    expect($defaults)->toBe([$second, $usd]);

    Catalog::as($this->manager, $this->company)->patchJson("/api/v1/price-lists/{$first}", ['is_default' => true, 'version' => 2])->assertOk();
    expect(Catalog::in($this->company, fn () => PriceList::query()->where('is_default', true)->orderBy('code')->pluck('id')->all()))->toBe([$first, $usd]);

    Catalog::post($this->manager, $this->company, 'price-lists', ['code' => 'BAD', 'name' => 'x', 'currency_code' => 'try'])
        ->assertStatus(422)->assertJsonValidationErrors(['currency_code'], 'errors.fields');
    Catalog::post($this->manager, $this->company, 'price-lists', ['code' => 'BAD', 'name' => 'x', 'currency_code' => 'TRY', 'valid_from' => '2026-05-01', 'valid_to' => '2026-04-01'])
        ->assertStatus(422)->assertJsonValidationErrors(['valid_to'], 'errors.fields');
    Catalog::as($this->manager, $this->company)->patchJson("/api/v1/price-lists/{$first}", ['valid_to' => '2025-01-01', 'version' => 3])
        ->assertStatus(422)->assertJsonValidationErrors(['valid_to'], 'errors.fields');
    Catalog::as($this->viewer, $this->company)->getJson('/api/v1/price-lists?filter[currency_code]=TRY&filter[is_default]=1')
        ->assertOk()->assertJsonCount(1, 'data');
    Catalog::post($this->viewer, $this->company, 'price-lists', ['code' => 'NO', 'name' => 'x', 'currency_code' => 'TRY'])->assertStatus(403);
    Catalog::as($this->manager, $this->company)->deleteJson("/api/v1/price-lists/{$usd}")->assertNoContent();
});

it('creates single lines and rejects duplicate natural keys', function (): void {
    $uri = "price-lists/{$this->list->id}/lines";
    $line = ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => '10.5', 'min_qty' => '5'];

    $id = Catalog::post($this->manager, $this->company, $uri, $line)
        ->assertCreated()->assertJsonPath('data.price', '10.500000')->assertJsonPath('data.min_qty', '5.000000')->json('data.id');
    // 5 and 5.000000 are the same key.
    Catalog::post($this->manager, $this->company, $uri, [...$line, 'min_qty' => '5.000000', 'price' => '9'])
        ->assertStatus(422)->assertJsonValidationErrors(['item_id'], 'errors.fields');
    // Variant and validity are part of the key, also when null.
    Catalog::post($this->manager, $this->company, $uri, [...$line, 'variant_id' => $this->variant->id])->assertCreated();
    Catalog::post($this->manager, $this->company, $uri, [...$line, 'valid_from' => '2026-01-01'])->assertCreated();

    Catalog::post($this->manager, $this->company, $uri, [...$line, 'unit_id' => $this->kg->id, 'min_qty' => '1'])
        ->assertStatus(422)->assertJsonValidationErrors(['unit_id'], 'errors.fields');
    Catalog::post($this->manager, $this->company, $uri, [...$line, 'price' => '-1', 'min_qty' => '2'])
        ->assertStatus(422)->assertJsonValidationErrors(['price'], 'errors.fields');

    Catalog::as($this->manager, $this->company)->patchJson("/api/v1/{$uri}/{$id}", ['price' => '11', 'version' => 1])
        ->assertOk()->assertJsonPath('data.price', '11.000000');
    Catalog::as($this->manager, $this->company)->patchJson("/api/v1/{$uri}/{$id}", ['valid_from' => '2026-02-01', 'valid_to' => '2026-01-01', 'version' => 2])
        ->assertStatus(422)->assertJsonValidationErrors(['valid_to'], 'errors.fields');
    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/{$uri}?filter[variant_id]={$this->variant->id}")->assertOk()->assertJsonCount(1, 'data');
    Catalog::as($this->viewer, $this->company)->patchJson("/api/v1/{$uri}/{$id}", ['price' => '1', 'version' => 2])->assertStatus(403);
    Catalog::as($this->manager, $this->company)->deleteJson("/api/v1/{$uri}/{$id}")->assertNoContent();
});

it('upserts lines in bulk by natural key', function (): void {
    ($this->put)([
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => '10'],
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'min_qty' => '10', 'price' => '9'],
        ['item_id' => $this->item->id, 'unit_id' => $this->box->id, 'price' => '100', 'variant_id' => $this->variant->id],
    ])->assertOk()->assertJsonCount(3, 'data')->assertJsonPath('meta', ['created' => 3, 'updated' => 0, 'unchanged' => 0]);

    $response = ($this->put)([
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'min_qty' => '10.000', 'price' => '8.5', 'version' => 1],
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => '10', 'version' => 1],
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'min_qty' => '100', 'price' => '8'],
    ])->assertOk()->assertJsonPath('meta', ['created' => 1, 'updated' => 1, 'unchanged' => 1]);

    expect($response->json('data.0.price'))->toBe('8.500000')
        ->and($response->json('data.0.version'))->toBe(2)
        ->and(($this->lines)())->toBe(4);
});

it('reports errors per line and writes nothing when any line fails', function (): void {
    $foreignItem = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'));
    $otherItem = Catalog::item($this->company, $this->pcs);
    $good = ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => '10'];

    $response = ($this->put)([
        $good,
        ['item_id' => $foreignItem->id, 'unit_id' => $this->pcs->id, 'price' => '1'],
        ['item_id' => $otherItem->id, 'unit_id' => $this->pcs->id, 'price' => '1', 'variant_id' => $this->variant->id],
        ['item_id' => $this->item->id, 'unit_id' => $this->kg->id, 'price' => '1'],
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => 'abc', 'min_qty' => '3'],
        [...$good, 'min_qty' => '0.0'],
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => '1', 'min_qty' => '4', 'valid_from' => '2026-02-01', 'valid_to' => '2026-01-01'],
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => '1', 'min_qty' => '7', 'colour' => 'red'],
    ])->assertStatus(422)->assertJsonPath('errors.code', 'VALIDATION_ERROR');

    expect(array_keys($response->json('errors.fields')))->toEqualCanonicalizing([
        'lines.1.item_id', 'lines.2.variant_id', 'lines.3.unit_id', 'lines.4.price', 'lines.5.item_id', 'lines.6.valid_to', 'lines.7',
    ])->and(($this->lines)())->toBe(0);

    // A stale or unknown version fails its line and rolls back the whole batch.
    ($this->put)([$good])->assertOk();
    // Overwriting an existing line without its version would silently drop a newer price.
    ($this->put)([[...$good, 'price' => '11']])->assertStatus(422)->assertJsonValidationErrors(['lines.0.version'], 'errors.fields');
    ($this->put)([
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'min_qty' => '50', 'price' => '5'],
        [...$good, 'price' => '12', 'version' => 9],
        ['item_id' => $this->item->id, 'unit_id' => $this->box->id, 'price' => '5', 'version' => 1],
    ])->assertStatus(422)->assertJsonValidationErrors(['lines.1.version', 'lines.2.version'], 'errors.fields');
    expect(($this->lines)())->toBe(1)
        ->and(Catalog::in($this->company, fn () => (string) PriceListLine::query()->value('price')))->toBe('10.000000');
});

it('caps a batch at 1000 lines and needs update permission', function (): void {
    $lines = [];

    for ($i = 0; $i < 1001; $i++) {
        $lines[] = ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'min_qty' => (string) $i, 'price' => '1'];
    }

    ($this->put)($lines)->assertStatus(422)->assertJsonValidationErrors(['lines'], 'errors.fields');
    ($this->put)([])->assertStatus(422)->assertJsonValidationErrors(['lines'], 'errors.fields');
    ($this->put)([$lines[0]], $this->viewer)->assertStatus(403);

    array_pop($lines);
    ($this->put)($lines)->assertOk()->assertJsonPath('meta.created', 1000);
    expect(($this->lines)())->toBe(1000);
});

it('isolates price lists and their lines between companies', function (): void {
    $foreign = Catalog::priceList($this->other);
    $foreignLine = Catalog::line($this->other, $foreign, Catalog::item($this->other, $u = Catalog::unit($this->other, 'PCS')), $u, '1');

    Catalog::as($this->manager, $this->company)->getJson("/api/v1/price-lists/{$foreign->id}")->assertNotFound();
    Catalog::as($this->manager, $this->company)->getJson("/api/v1/price-lists/{$foreign->id}/lines")->assertNotFound();
    Catalog::as($this->manager, $this->company)->putJson("/api/v1/price-lists/{$foreign->id}/lines", ['lines' => [
        ['item_id' => $this->item->id, 'unit_id' => $this->pcs->id, 'price' => '1'],
    ]])->assertNotFound();
    // A line id of another list (here: another company) is never reachable through this list.
    Catalog::as($this->manager, $this->company)->patchJson("/api/v1/price-lists/{$this->list->id}/lines/{$foreignLine->id}", ['price' => '2', 'version' => 1])
        ->assertNotFound();
    Catalog::as($this->manager, $this->company)->deleteJson("/api/v1/price-lists/{$this->list->id}/lines/".Str::uuid7())->assertNotFound();
});
