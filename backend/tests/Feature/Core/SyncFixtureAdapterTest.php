<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\OutcomeStatus;
use App\Models\User;
use App\Modules\Identity\Services\DeviceTokens;
use Illuminate\Auth\GenericUser;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\FixtureNoteSyncResource;
use Tests\Fixtures\Sync\FixtureNoteSyncWriter;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Fixtures\Sync\SyncFixtures;
use Tests\Support\Identity;
use Tests\Support\Sync;

uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncFixtures::install();
    SyncFixtures::register(app());
    $this->company = (string) Str::uuid7();
    app(CompanyContext::class)->set($this->company);
    $this->user = new GenericUser(['id' => (string) Str::uuid7()]);
});

/**
 * @param  array<string, mixed>  $overrides
 */
function fixtureMutation(array $overrides = []): Mutation
{
    return Mutation::fromArray(array_merge([
        'idempotency_key' => (string) Str::uuid7(),
        'op' => 'create',
        'resource' => FixtureNoteSyncResource::NAME,
        'id' => (string) Str::uuid7(),
        'base_version' => null,
        'changed_fields' => [],
        'occurred_at' => now()->toIso8601String(),
        'payload' => ['title' => 'Offline note', 'lines' => [['body' => 'first']]],
    ], $overrides));
}

it('registers the fixture adapters under the core tags', function (): void {
    // Module adapters share the tags, so only the fixture adapters are counted.
    $resources = array_values(array_filter(
        iterator_to_array(app()->tagged(SyncResource::TAG), false),
        fn (SyncResource $resource): bool => $resource instanceof FixtureNoteSyncResource,
    ));
    $writers = array_values(array_filter(
        iterator_to_array(app()->tagged(SyncWriter::TAG), false),
        fn (SyncWriter $writer): bool => $writer instanceof FixtureNoteSyncWriter,
    ));

    expect($resources)->toHaveCount(1)
        ->and($writers)->toHaveCount(1)
        ->and($writers[0]->resource())->toBe($resources[0]->name())
        ->and($resources[0]->name())->toBe(FixtureNoteSyncResource::NAME);
});

it('creates with the client id, updates, closes and deletes through the writer', function (): void {
    $writer = app(FixtureNoteSyncWriter::class);
    $create = fixtureMutation();

    $created = DB::transaction(fn () => $writer->create($this->user, $create));

    expect($created->status)->toBe(OutcomeStatus::Applied)
        ->and($created->version)->toBe(1)
        ->and($created->data['id'] ?? null)->toBe($create->id)
        ->and($created->data['lines'][0]['body'] ?? null)->toBe('first');

    $note = $writer->find($create->id);
    $update = fixtureMutation(['op' => 'update', 'id' => $create->id, 'base_version' => 1, 'changed_fields' => ['title'], 'payload' => ['title' => 'Edited']]);
    $updated = $writer->update($this->user, $update, $note, 1);

    expect($updated->status)->toBe(OutcomeStatus::Applied)->and($updated->version)->toBe(2);

    $stale = $writer->update($this->user, $update, $writer->find($create->id), 1);
    expect($stale->errorCode)->toBe(ErrorCode::VersionConflict);

    $close = fixtureMutation(['op' => 'action', 'action' => 'close', 'id' => $create->id, 'base_version' => 2, 'changed_fields' => ['status'], 'payload' => ['status' => 'closed']]);
    $closed = $writer->action($this->user, $close, $writer->find($create->id), 2);

    expect($closed->status)->toBe(OutcomeStatus::Applied)
        ->and($writer->isDraft($writer->find($create->id)))->toBeFalse()
        ->and($writer->targetSatisfies($writer->find($create->id), ['status' => 'closed']))->toBeTrue();

    $delete = fixtureMutation(['op' => 'delete', 'id' => $create->id, 'base_version' => 3, 'payload' => []]);
    $deleted = $writer->delete($this->user, $delete, $writer->find($create->id), 3);

    expect($deleted->toArray())->toBe(['status' => 'applied', 'data' => null])
        ->and(Sync::tombstone('sync_fixture_notes', $create->id)?->reason)->toBe('soft_deleted');
});

it('reports validation failures as a rejected outcome', function (): void {
    $outcome = app(FixtureNoteSyncWriter::class)->create($this->user, fixtureMutation(['payload' => ['title' => 'reject']]));

    expect($outcome->status)->toBe(OutcomeStatus::Rejected)
        ->and($outcome->errorCode)->toBe(ErrorCode::ValidationError)
        ->and($outcome->errorFields)->toHaveKey('title');
});

it('serves committed rows of the company through the resource query, ordered by position', function (): void {
    $resource = app(FixtureNoteSyncResource::class);
    $mine = FixtureNote::query()->create(['title' => 'Mine']);
    $other = app(CompanyContext::class)->runAs((string) Str::uuid7(), fn () => FixtureNote::query()->create(['title' => 'Theirs']));
    $horizon = Sync::awaitHorizonPast(Sync::txidOf('sync_fixture_notes', $mine->id));

    $rows = $resource->query($this->company)
        ->whereRaw("{$resource->positionColumn()} < ?::xid8", [$horizon->value])
        ->orderByRaw("{$resource->positionColumn()}, sync_fixture_notes.id")
        ->get();

    expect($rows->pluck('id')->all())->toBe([$mine->id])
        ->and($rows->pluck('id')->all())->not->toContain($other->id)
        ->and($rows->first()?->relationLoaded('lines'))->toBeTrue();
});

it('issues desktop device tokens for sync requests', function (): void {
    app(CompanyContext::class)->clear(); // the fixture company has no companies row
    Identity::boot();
    $company = Identity::company();
    $user = Identity::member($company);

    $headers = Sync::deviceHeaders($user, $company);
    $token = PersonalAccessToken::findToken(substr($headers['Authorization'], 7));

    expect($token?->can(DeviceTokens::ABILITY))->toBeTrue()
        ->and($token?->tokenable)->toBeInstanceOf(User::class)
        ->and($headers['X-Company-Id'])->toBe($company->id);

    $this->getJson('/api/v1/me/devices', $headers)->assertOk();
});
