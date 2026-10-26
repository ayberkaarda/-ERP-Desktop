<?php

declare(strict_types=1);

use App\Modules\Catalog\Models\ItemBarcode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->editor = Actors::user(['items.view', 'items.update']);
    $this->viewer = Actors::user(['items.view']);
    $this->other = Actors::company();
    $this->pcs = Catalog::unit($this->company, 'PCS');
    $this->box = Catalog::unit($this->company, 'BOX');
    $this->item = Catalog::item($this->company, $this->pcs, ['code' => 'TSHIRT']);
});

it('creates variants with generated or given SKUs unique per company', function (): void {
    $base = "items/{$this->item->id}/variants";

    Catalog::post($this->editor, $this->company, $base, ['attributes' => ['size' => 'M']])
        ->assertCreated()->assertJsonPath('data.sku', 'TSHIRT-001')->assertJsonPath('data.attributes.size', 'M');
    Catalog::post($this->editor, $this->company, $base, ['sku' => 'TS-L', 'name' => 'Large'])->assertCreated();
    Catalog::post($this->editor, $this->company, $base, [])->assertCreated()->assertJsonPath('data.sku', 'TSHIRT-003');
    Catalog::post($this->editor, $this->company, $base, ['sku' => 'TS-L'])
        ->assertStatus(422)->assertJsonValidationErrors(['sku'], 'errors.fields');

    // Another item of the same company cannot reuse the SKU; another company can.
    $other = Catalog::item($this->company, $this->pcs);
    Catalog::post($this->editor, $this->company, "items/{$other->id}/variants", ['sku' => 'TS-L'])->assertStatus(422);
    $foreignItem = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'));
    Catalog::post(Actors::user(['items.update'], $this->other), $this->other, "items/{$foreignItem->id}/variants", ['sku' => 'TS-L'])->assertCreated();

    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/{$base}?sort=sku")->assertOk()->assertJsonCount(3, 'data');
    Catalog::post($this->viewer, $this->company, $base, ['sku' => 'NOPE'])->assertStatus(403);
});

it('scopes variants to their item', function (): void {
    $variant = Catalog::variant($this->company, $this->item, 'TS-S');
    $other = Catalog::item($this->company, $this->pcs);

    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/items/{$other->id}/variants/{$variant->id}")->assertNotFound();
    Catalog::as($this->editor, $this->company)->patchJson("/api/v1/items/{$this->item->id}/variants/{$variant->id}", ['name' => 'Small', 'version' => 1])
        ->assertOk()->assertJsonPath('data.name', 'Small');
    Catalog::as($this->editor, $this->company)->deleteJson("/api/v1/items/{$this->item->id}/variants/{$variant->id}")->assertNoContent();
});

it('validates check digits of declared GTIN barcodes', function (): void {
    $base = "items/{$this->item->id}/barcodes";

    Catalog::post($this->editor, $this->company, $base, ['barcode' => '4006381333932', 'type' => 'ean13'])
        ->assertStatus(422)->assertJsonValidationErrors(['barcode'], 'errors.fields');
    Catalog::post($this->editor, $this->company, $base, ['barcode' => '96385075', 'type' => 'ean8'])->assertStatus(422);
    Catalog::post($this->editor, $this->company, $base, ['barcode' => '036000291453', 'type' => 'upca'])->assertStatus(422);
    Catalog::post($this->editor, $this->company, $base, ['barcode' => '4006381333931', 'type' => 'ean8'])->assertStatus(422);

    Catalog::post($this->editor, $this->company, $base, ['barcode' => '4006381333931', 'type' => 'ean13'])
        ->assertCreated()->assertJsonPath('data.unit_id', $this->pcs->id)->assertJsonPath('data.is_primary', true);
    Catalog::post($this->editor, $this->company, $base, ['barcode' => '036000291452', 'type' => 'upca'])
        ->assertCreated()->assertJsonPath('data.is_primary', false);
    // Free-form types are not check-digit validated.
    Catalog::post($this->editor, $this->company, $base, ['barcode' => 'ABC-123', 'type' => 'code128'])->assertCreated();
    Catalog::post($this->editor, $this->company, $base, ['barcode' => 'has space'])->assertStatus(422);

    // Changing the type of a stored barcode re-validates it.
    $id = Catalog::in($this->company, fn () => ItemBarcode::query()->where('barcode', 'ABC-123')->value('id'));
    Catalog::as($this->editor, $this->company)->patchJson("/api/v1/{$base}/{$id}", ['type' => 'ean13', 'version' => 1])
        ->assertStatus(422)->assertJsonValidationErrors(['barcode'], 'errors.fields');
});

it('keeps barcodes unique per company and one primary per item', function (): void {
    $base = "items/{$this->item->id}/barcodes";
    $first = Catalog::post($this->editor, $this->company, $base, ['barcode' => '5901234123457', 'type' => 'ean13'])->json('data.id');
    $second = Catalog::post($this->editor, $this->company, $base, ['barcode' => '96385074', 'type' => 'ean8', 'is_primary' => true])
        ->assertCreated()->assertJsonPath('data.is_primary', true)->json('data.id');

    $primaries = fn (): array => Catalog::in($this->company, fn () => ItemBarcode::query()->where('item_id', $this->item->id)->where('is_primary', true)->pluck('id')->all());
    expect($primaries())->toBe([$second]);

    // Losing the primary flag was a change of the first barcode: its version moved on.
    Catalog::as($this->editor, $this->company)->patchJson("/api/v1/{$base}/{$first}", ['is_primary' => true, 'version' => 1])->assertStatus(409);
    Catalog::as($this->editor, $this->company)->patchJson("/api/v1/{$base}/{$first}", ['is_primary' => true, 'version' => 2])->assertOk();
    expect($primaries())->toBe([$first]);

    // Deleting the primary promotes the next one.
    Catalog::as($this->editor, $this->company)->deleteJson("/api/v1/{$base}/{$first}")->assertNoContent();
    expect($primaries())->toBe([$second]);

    $other = Catalog::item($this->company, $this->pcs);
    Catalog::post($this->editor, $this->company, "items/{$other->id}/barcodes", ['barcode' => '96385074', 'type' => 'ean8'])
        ->assertStatus(422)->assertJsonValidationErrors(['barcode'], 'errors.fields');

    $foreign = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'));
    Catalog::post(Actors::user(['items.update'], $this->other), $this->other, "items/{$foreign->id}/barcodes", ['barcode' => '96385074', 'type' => 'ean8'])
        ->assertCreated();
});

it('ties barcodes to units and variants of the same item', function (): void {
    $base = "items/{$this->item->id}/barcodes";
    $kg = Catalog::unit($this->company, 'KG');
    $other = Catalog::item($this->company, $this->pcs);
    $foreignVariant = Catalog::variant($this->company, $other, 'OTHER-1');

    Catalog::post($this->editor, $this->company, $base, ['barcode' => 'B1', 'unit_id' => $kg->id])
        ->assertStatus(422)->assertJsonValidationErrors(['unit_id'], 'errors.fields');
    Catalog::post($this->editor, $this->company, $base, ['barcode' => 'B1', 'variant_id' => $foreignVariant->id])
        ->assertStatus(422)->assertJsonValidationErrors(['variant_id'], 'errors.fields');

    Catalog::itemUnit($this->company, $this->item, $this->box, '12');
    $variant = Catalog::variant($this->company, $this->item, 'TS-M');
    Catalog::post($this->editor, $this->company, $base, ['barcode' => 'B1', 'unit_id' => $this->box->id, 'variant_id' => $variant->id])
        ->assertCreated()->assertJsonPath('data.variant_id', $variant->id)->assertJsonPath('data.unit_id', $this->box->id);

    // Deleting the variant removes its barcodes.
    Catalog::as($this->editor, $this->company)->deleteJson("/api/v1/items/{$this->item->id}/variants/{$variant->id}")->assertNoContent();
    expect(Catalog::in($this->company, fn () => ItemBarcode::query()->where('barcode', 'B1')->exists()))->toBeFalse();
});

it('manages alternate units with consistency rules', function (): void {
    $base = "items/{$this->item->id}/units";
    $pack = Catalog::unit($this->company, 'PACK');
    $crate = Catalog::unit($this->company, 'CRATE');

    Catalog::post($this->editor, $this->company, $base, ['unit_id' => $this->pcs->id, 'factor' => '1'])
        ->assertStatus(422)->assertJsonValidationErrors(['unit_id'], 'errors.fields');
    Catalog::post($this->editor, $this->company, $base, ['unit_id' => $this->box->id, 'factor' => '0'])
        ->assertStatus(422)->assertJsonValidationErrors(['factor'], 'errors.fields');

    $id = Catalog::post($this->editor, $this->company, $base, ['unit_id' => $this->box->id, 'factor' => '12'])
        ->assertCreated()->assertJsonPath('data.factor', '12.000000')->assertJsonPath('data.unit.code', 'BOX')->json('data.id');
    Catalog::post($this->editor, $this->company, $base, ['unit_id' => $this->box->id, 'factor' => '6'])
        ->assertStatus(422)->assertJsonValidationErrors(['unit_id'], 'errors.fields');

    // The company graph says 1 pack = 6 pcs; an item factor must agree.
    Catalog::conversion($this->company, $pack, $this->pcs, '6');
    Catalog::post($this->editor, $this->company, $base, ['unit_id' => $pack->id, 'factor' => '5'])
        ->assertStatus(422)->assertJsonValidationErrors(['factor'], 'errors.fields');
    Catalog::post($this->editor, $this->company, $base, ['unit_id' => $pack->id, 'factor' => '6'])->assertCreated();
    Catalog::post($this->editor, $this->company, $base, ['unit_id' => $crate->id, 'factor' => '48'])->assertCreated();

    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/items/{$this->item->id}")
        ->assertOk()->assertJsonCount(3, 'data.units');

    Catalog::as($this->editor, $this->company)->patchJson("/api/v1/{$base}/{$id}", ['factor' => '24', 'version' => 1])
        ->assertOk()->assertJsonPath('data.factor', '24.000000');

    // A unit used by a barcode of the item stays.
    Catalog::post($this->editor, $this->company, "items/{$this->item->id}/barcodes", ['barcode' => 'BOX-1', 'unit_id' => $this->box->id])->assertCreated();
    Catalog::as($this->editor, $this->company)->deleteJson("/api/v1/{$base}/{$id}")
        ->assertStatus(422)->assertJsonValidationErrors(['unit'], 'errors.fields');
    Catalog::as($this->viewer, $this->company)->deleteJson("/api/v1/{$base}/{$id}")->assertStatus(403);
});

it('hides parts of items in other companies', function (): void {
    $foreign = Catalog::item($this->other, Catalog::unit($this->other, 'PCS'));

    foreach (['variants', 'barcodes', 'units'] as $part) {
        Catalog::as($this->editor, $this->company)->getJson("/api/v1/items/{$foreign->id}/{$part}")->assertNotFound();
        Catalog::post($this->editor, $this->company, "items/{$foreign->id}/{$part}", ['sku' => 'X', 'barcode' => 'X', 'unit_id' => $this->box->id, 'factor' => '2'])
            ->assertNotFound();
    }
});
