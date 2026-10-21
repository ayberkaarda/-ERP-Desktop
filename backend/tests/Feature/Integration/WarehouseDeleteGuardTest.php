<?php

declare(strict_types=1);

use App\Modules\Inventory\Contracts\WarehouseLookup;
use App\Modules\Reference\Services\ExternalReferences;
use App\Modules\Reference\Services\NullLookup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->user = Actors::user(['warehouses.view', 'warehouses.delete']);
    $this->delete = fn (string $id, int $version = 1) => Inv::as($this->user, $this->company)
        ->deleteJson('/api/v1/warehouses/'.$id.'?version='.$version);
});

it('refuses to delete a Reference warehouse that has stock movements', function (): void {
    $wh = Inv::warehouse($this->company, 'USED');
    $item = Inv::item($this->company)->id;
    Inv::receive($this->company, $wh->id, $item, '2', '3');
    Inv::issue($this->company, $wh->id, $item, '2');

    // Even with nothing left on hand, the movements keep the warehouse.
    expect(Inv::onHand($this->company, $item, $wh->id))->toBe('0.000000');
    ($this->delete)($wh->id)->assertUnprocessable()
        ->assertJsonPath('errors.code', 'VALIDATION_ERROR')
        ->assertJsonPath('errors.fields.is_active.0', __('reference::messages.warehouse_has_movements'));

    expect(DB::table('warehouses')->where('id', $wh->id)->whereNull('deleted_at')->exists())->toBeTrue();
});

it('asks Inventory through its WarehouseLookup contract and still deletes an unused warehouse', function (): void {
    $used = Inv::warehouse($this->company, 'USED');
    $unused = Inv::warehouse($this->company, 'UNUSED');
    Inv::receive($this->company, $used->id, Inv::item($this->company)->id, '1', '1');

    expect(app(ExternalReferences::STOCK_WAREHOUSE_LOOKUP))->toBeInstanceOf(WarehouseLookup::class);
    ($this->delete)($unused->id)->assertNoContent();
    expect(DB::table('warehouses')->where('id', $unused->id)->whereNotNull('deleted_at')->exists())->toBeTrue();

    // Without the Inventory module (fallback lookup) Reference has no movements to check.
    app()->instance(ExternalReferences::STOCK_WAREHOUSE_LOOKUP, new NullLookup);
    ($this->delete)($used->id)->assertNoContent();
});

it('does not count movements of another company in the same warehouse id check', function (): void {
    $mine = Inv::warehouse($this->company, 'MINE');
    $other = Inv::company();
    $theirs = Inv::warehouse($other, 'THEIRS');
    Inv::receive($other, $theirs->id, Inv::item($other)->id, '1', '1');

    ($this->delete)($mine->id)->assertNoContent();
    // The other company's warehouse is not visible here at all.
    ($this->delete)($theirs->id)->assertNotFound();
});
