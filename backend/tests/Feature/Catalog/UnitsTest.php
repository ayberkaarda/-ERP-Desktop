<?php

declare(strict_types=1);

use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use App\Modules\Catalog\Services\UnitConversionMissing;
use App\Modules\Catalog\Services\UnitConverter;
use App\Modules\Identity\Models\Activity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->admin = Actors::user(['units.manage', 'items.view']);
    $this->viewer = Actors::user(['items.view']);
    $this->other = Actors::company();
    $this->outsider = Actors::user(['units.manage'], $this->other);
});

it('creates, lists, updates and soft deletes units with audit entries', function (): void {
    $id = Catalog::post($this->admin, $this->company, 'units', ['code' => 'PCS', 'name' => 'Piece', 'symbol' => 'pc'])
        ->assertCreated()->assertJsonPath('data.code', 'PCS')->assertJsonPath('data.version', 1)->json('data.id');

    Catalog::as($this->viewer, $this->company)->getJson('/api/v1/units?q=pie')->assertOk()->assertJsonPath('data.0.id', $id);
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/units/{$id}", ['name' => 'Pieces', 'version' => 1])
        ->assertOk()->assertJsonPath('data.name', 'Pieces')->assertJsonPath('data.version', 2);

    $log = Activity::withoutCompanyScope()->where('subject_id', $id)->where('event', 'updated')->firstOrFail();
    expect($log->company_id)->toBe($this->company)
        ->and($log->attribute_changes?->get('old'))->toBe(['name' => 'Piece']);

    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/units/{$id}")->assertNoContent();
    expect(Catalog::in($this->company, fn () => Unit::withTrashed()->find($id)?->trashed()))->toBeTrue();

    // A deleted code is free again.
    Catalog::post($this->admin, $this->company, 'units', ['code' => 'PCS', 'name' => 'Piece'])->assertCreated();
});

it('keeps codes unique per company only', function (): void {
    Catalog::unit($this->company, 'KG');

    Catalog::post($this->admin, $this->company, 'units', ['code' => 'KG', 'name' => 'Kilogram'])
        ->assertStatus(422)->assertJsonValidationErrors(['code'], 'errors.fields');
    Catalog::post($this->outsider, $this->other, 'units', ['code' => 'KG', 'name' => 'Kilogram'])->assertCreated();
});

it('requires the current version on update', function (): void {
    $unit = Catalog::unit($this->company, 'BOX');

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/units/{$unit->id}", ['name' => 'x'])
        ->assertStatus(422)->assertJsonValidationErrors(['version'], 'errors.fields');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/units/{$unit->id}", ['name' => 'x', 'version' => 7])
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/units/{$unit->id}?version=3")
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
});

it('needs units.manage to write and items.view or units.manage to read', function (): void {
    $unit = Catalog::unit($this->company, 'M');
    $nobody = Actors::user();

    Catalog::post($this->viewer, $this->company, 'units', ['code' => 'L', 'name' => 'Litre'])->assertStatus(403);
    Catalog::as($this->viewer, $this->company)->patchJson("/api/v1/units/{$unit->id}", ['name' => 'x', 'version' => 1])->assertStatus(403);
    Catalog::as($this->viewer, $this->company)->deleteJson("/api/v1/units/{$unit->id}")->assertStatus(403);
    Catalog::as($nobody, $this->company)->getJson('/api/v1/units')->assertStatus(403);
    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/units/{$unit->id}")->assertOk();
});

it('never shows or changes units of another company', function (): void {
    $foreign = Catalog::unit($this->other, 'FOREIGN');

    Catalog::as($this->admin, $this->company)->getJson("/api/v1/units/{$foreign->id}")->assertNotFound();
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/units/{$foreign->id}", ['name' => 'x', 'version' => 1])->assertNotFound();
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/units/{$foreign->id}")->assertNotFound();
    Catalog::as($this->admin, $this->company)->getJson('/api/v1/units')->assertOk()->assertJsonCount(0, 'data');
    // Membership is checked before anything else.
    Catalog::as($this->admin, $this->other)->getJson('/api/v1/units')->assertStatus(403);
});

it('refuses to delete a unit that is referenced', function (): void {
    $pcs = Catalog::unit($this->company, 'PCS');
    Catalog::item($this->company, $pcs);

    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/units/{$pcs->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['unit'], 'errors.fields');
});

it('builds a conversion forest and rejects cycles, duplicates and bad factors', function (): void {
    $pcs = Catalog::unit($this->company, 'PCS');
    $box = Catalog::unit($this->company, 'BOX');
    $pallet = Catalog::unit($this->company, 'PAL');

    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $box->id, 'to_unit_id' => $pcs->id, 'factor' => '12'])
        ->assertCreated()->assertJsonPath('data.factor', '12.000000')->assertJsonPath('data.from_unit.code', 'BOX');
    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $pallet->id, 'to_unit_id' => $box->id, 'factor' => '40'])
        ->assertCreated();

    // Closing the triangle, or the reverse of an existing edge, is a cycle.
    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $pcs->id, 'to_unit_id' => $pallet->id, 'factor' => '0.002083'])
        ->assertStatus(422)->assertJsonValidationErrors(['to_unit_id'], 'errors.fields');
    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $pcs->id, 'to_unit_id' => $box->id, 'factor' => '0.083333'])
        ->assertStatus(422);

    $kg = Catalog::unit($this->company, 'KG');
    $g = Catalog::unit($this->company, 'G');

    foreach (['0', '0.000000', '-1', '1e3', 'abc'] as $factor) {
        Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $kg->id, 'to_unit_id' => $g->id, 'factor' => $factor])
            ->assertStatus(422)->assertJsonValidationErrors(['factor'], 'errors.fields');
    }

    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $kg->id, 'to_unit_id' => $kg->id, 'factor' => '1'])
        ->assertStatus(422)->assertJsonValidationErrors(['to_unit_id'], 'errors.fields');

    $foreign = Catalog::unit($this->other, 'FOREIGN');
    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $kg->id, 'to_unit_id' => $foreign->id, 'factor' => '1'])
        ->assertStatus(422)->assertJsonValidationErrors(['to_unit_id'], 'errors.fields');

    expect(Catalog::in($this->company, fn () => UnitConversion::query()->count()))->toBe(2);
});

it('converts exactly through the graph endpoint', function (): void {
    $pcs = Catalog::unit($this->company, 'PCS');
    $box = Catalog::unit($this->company, 'BOX');
    $pallet = Catalog::unit($this->company, 'PAL');
    Catalog::conversion($this->company, $box, $pcs, '12');
    Catalog::conversion($this->company, $pallet, $box, '40');

    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/units/convert?qty=2&from_unit_id={$pallet->id}&to_unit_id={$pcs->id}")
        ->assertOk()->assertJsonPath('data.result', '960.000000');
    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/units/convert?qty=1&from_unit_id={$pcs->id}&to_unit_id={$pallet->id}")
        ->assertOk()->assertJsonPath('data.result', '0.002083');
    // 480 pcs -> 1 pallet exactly: the rational path never accumulates rounding errors.
    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/units/convert?qty=480&from_unit_id={$pcs->id}&to_unit_id={$pallet->id}")
        ->assertOk()->assertJsonPath('data.result', '1.000000');

    $kg = Catalog::unit($this->company, 'KG');
    Catalog::as($this->viewer, $this->company)->getJson("/api/v1/units/convert?qty=1&from_unit_id={$kg->id}&to_unit_id={$pcs->id}")
        ->assertStatus(422)->assertJsonValidationErrors(['unit_id'], 'errors.fields');
});

it('updates a conversion factor with its version and keeps endpoints immutable', function (): void {
    $pcs = Catalog::unit($this->company, 'PCS');
    $box = Catalog::unit($this->company, 'BOX');
    $c = Catalog::conversion($this->company, $box, $pcs, '12');

    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/unit-conversions/{$c->id}", ['factor' => '24', 'version' => 1])
        ->assertOk()->assertJsonPath('data.factor', '24.000000')->assertJsonPath('data.version', 2);
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/unit-conversions/{$c->id}", ['factor' => '6', 'to_unit_id' => $box->id, 'version' => 2])
        ->assertStatus(422)->assertJsonValidationErrors(['to_unit_id'], 'errors.fields');
    Catalog::as($this->admin, $this->company)->getJson("/api/v1/unit-conversions?filter[unit_id]={$pcs->id}")->assertOk()->assertJsonCount(1, 'data');
    Catalog::as($this->admin, $this->company)->getJson('/api/v1/unit-conversions?filter[unit_id]=nope')->assertStatus(422);
    Catalog::as($this->admin, $this->company)->deleteJson("/api/v1/unit-conversions/{$c->id}")->assertNoContent();
});

it('keeps item alternate units consistent with the company graph', function (): void {
    $pcs = Catalog::unit($this->company, 'PCS');
    $box = Catalog::unit($this->company, 'BOX');
    $item = Catalog::item($this->company, $pcs, ['code' => 'WIDGET']);
    Catalog::itemUnit($this->company, $item, $box, '12');

    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $box->id, 'to_unit_id' => $pcs->id, 'factor' => '10'])
        ->assertStatus(422)->assertJsonValidationErrors(['factor'], 'errors.fields')->assertJsonPath('errors.fields.factor.0', fn (string $m) => str_contains($m, 'WIDGET'));
    Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $pcs->id, 'to_unit_id' => $box->id, 'factor' => '0.5'])
        ->assertStatus(422)->assertJsonValidationErrors(['factor'], 'errors.fields');

    $cid = Catalog::post($this->admin, $this->company, 'unit-conversions', ['from_unit_id' => $box->id, 'to_unit_id' => $pcs->id, 'factor' => '12'])
        ->assertCreated()->json('data.id');
    Catalog::as($this->admin, $this->company)->patchJson("/api/v1/unit-conversions/{$cid}", ['factor' => '11', 'version' => 1])->assertStatus(422);
});

it('converts with item units first, then the graph, never with floats', function (): void {
    $pcs = Catalog::unit($this->company, 'PCS');
    $box = Catalog::unit($this->company, 'BOX');
    $pack = Catalog::unit($this->company, 'PACK');
    $crate = Catalog::unit($this->company, 'CRATE');
    $kg = Catalog::unit($this->company, 'KG');
    $item = Catalog::item($this->company, $pcs);
    Catalog::itemUnit($this->company, $item, $box, '12');
    Catalog::itemUnit($this->company, $item, $pack, '3');
    // crate is only known to the graph: 1 crate = 4 box.
    Catalog::conversion($this->company, $crate, $box, '4');

    Catalog::in($this->company, function () use ($pcs, $box, $pack, $crate, $kg, $item): void {
        $c = new UnitConverter;

        expect((string) $c->convert('2', $box->id, $pcs->id, $item->id))->toBe('24.000000')
            ->and((string) $c->convert('1', $box->id, $pack->id, $item->id))->toBe('4.000000')
            ->and((string) $c->convert('1', $pack->id, $box->id, $item->id))->toBe('0.250000')
            ->and((string) $c->convert('1', $pcs->id, $pack->id, $item->id))->toBe('0.333333')
            ->and((string) $c->convert('1', $pcs->id, $pack->id, $item->id, 2))->toBe('0.33')
            ->and((string) $c->convertExact('1', $pcs->id, $pack->id, $item->id))->toBe('1/3')
            ->and((string) $c->convert('1', $crate->id, $pcs->id, $item->id))->toBe('48.000000')
            ->and((string) $c->convert('0.000001', $crate->id, $pcs->id, $item->id))->toBe('0.000048')
            // Without the item only the graph applies.
            ->and($c->canConvert($box->id, $pcs->id))->toBeFalse()
            ->and($c->canConvert($crate->id, $box->id))->toBeTrue()
            ->and(fn () => $c->convert('1', $kg->id, $pcs->id, $item->id))->toThrow(UnitConversionMissing::class)
            ->and($c->canConvert($box->id, $pcs->id, (string) Str::uuid7()))->toBeFalse()
            ->and($c->canConvert($box->id, $pcs->id, 'not-a-uuid'))->toBeFalse();
    });
});
