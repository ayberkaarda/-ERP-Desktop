<?php

declare(strict_types=1);

/*
 * Read side of the parties adapter against committed data: sync positions, child touches and
 * tombstones need real commits (SyncDatabase), so this file stays apart from the
 * transaction-wrapped writer tests.
 */

use App\Core\Company\CompanyContext;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Sync\PartySyncResource;
use Illuminate\Support\Facades\DB;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Sync;

uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    app(CompanyContext::class)->set($this->company);
    $this->resource = new PartySyncResource;
});

it('pulls only the company parties with embeds and the REST shape', function (): void {
    $party = Party::factory()->create(['name' => 'Mine']);
    $party->contacts()->create(['name' => 'Ayse', 'is_primary' => true]);
    $other = Actors::company();
    app(CompanyContext::class)->runAs($other, fn () => Party::factory()->create(['name' => 'Theirs']));
    app(CompanyContext::class)->set($this->company);

    $rows = $this->resource->query($this->company)->get();

    expect($rows->pluck('name')->all())->toBe(['Mine'])
        ->and($rows->first()->relationLoaded('contacts'))->toBeTrue()
        ->and($rows->first()->contacts)->toHaveCount(1)
        ->and($this->resource->positionColumn())->toBe('parties.sync_txid');
});

it('moves the party position when a child changes without touching its version', function (): void {
    $party = Party::factory()->create();
    $before = Sync::txidOf('parties', $party->id);
    $versionBefore = $party->fresh()->version;

    $address = $address = $party->addresses()->create(['type' => 'billing', 'line1' => 'Sok 1', 'country' => 'TR']);
    $afterInsert = Sync::txidOf('parties', $party->id);
    $address->delete();
    $afterDelete = Sync::txidOf('parties', $party->id);

    expect($afterInsert->greaterThan($before))->toBeTrue()
        ->and($afterDelete->greaterThan($afterInsert))->toBeTrue()
        ->and($party->fresh()->version)->toBe($versionBefore);
});

it('is visible below the horizon and leaves a tombstone on soft delete', function (): void {
    $party = Party::factory()->create();
    $txid = Sync::txidOf('parties', $party->id);
    Sync::awaitHorizonPast($txid);

    expect(DB::table('parties')->whereRaw('sync_txid < ?::xid8', [Sync::horizon()->value])->where('id', $party->id)->exists())->toBeTrue();

    $party->delete();
    $tombstone = Sync::tombstone('parties', $party->id);

    expect($tombstone)->not->toBeNull()
        ->and($tombstone->company_id)->toBe($this->company);
});
