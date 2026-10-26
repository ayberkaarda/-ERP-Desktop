<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\OutcomeStatus;
use App\Modules\Identity\Models\Activity;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Sync\PartySyncResource;
use App\Modules\Parties\Sync\PartySyncWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->company = Actors::company();
    $this->manager = Actors::user(['parties.view', 'parties.create']);
    $this->viewer = Actors::user(['parties.view']);
    Identity::fresh();
    app(CompanyContext::class)->set($this->company);
    $this->writer = app(PartySyncWriter::class);
    $this->payload = [
        'name' => 'Acme Teknoloji', 'type' => 'company', 'roles' => ['customer'],
        'tax_number' => '4840847211', 'country' => 'TR',
    ];
});

/**
 * @param  array<string, mixed>  $overrides
 */
function partyMutation(array $overrides = []): Mutation
{
    return Mutation::fromArray(array_merge([
        'idempotency_key' => (string) Str::uuid7(),
        'op' => 'create',
        'resource' => 'parties',
        'id' => (string) Str::uuid7(),
        'base_version' => null,
        'changed_fields' => [],
        'occurred_at' => now()->toIso8601String(),
        'payload' => test()->payload,
    ], $overrides));
}

it('tags the parties adapters for the sync module', function (): void {
    $resources = collect(iterator_to_array(app()->tagged(SyncResource::TAG)))->filter(fn ($r) => $r instanceof PartySyncResource);
    $writers = collect(iterator_to_array(app()->tagged(SyncWriter::TAG)))->filter(fn ($w) => $w instanceof PartySyncWriter);

    expect($resources)->toHaveCount(1)
        ->and($writers)->toHaveCount(1)
        ->and($resources->first()->name())->toBe($writers->first()->resource())
        ->and($resources->first()->table())->toBe('parties')
        ->and($resources->first()->embeds())->toBe(['addresses', 'contacts', 'bankAccounts']);
});

it('creates a party with the client id through the REST rules', function (): void {
    $mutation = partyMutation();

    $outcome = $this->writer->create($this->manager, $mutation);

    expect($outcome->status)->toBe(OutcomeStatus::Applied)
        ->and($outcome->version)->toBe(1)
        ->and($outcome->data['id'])->toBe($mutation->id)
        ->and($outcome->data['code'])->toStartWith('P')
        ->and($outcome->data['addresses'])->toBe([])
        ->and(Party::query()->find($mutation->id)?->name)->toBe('Acme Teknoloji');
});

it('rejects what the REST request rejects', function (): void {
    $withCode = $this->writer->create($this->manager, partyMutation(['payload' => [...$this->payload, 'code' => 'X1']]));
    $noName = $this->writer->create($this->manager, partyMutation(['payload' => ['type' => 'company', 'roles' => ['customer']]]));

    expect($withCode->status)->toBe(OutcomeStatus::Rejected)
        ->and($withCode->errorCode)->toBe(ErrorCode::ValidationError)
        ->and($withCode->errorFields)->toHaveKey('code')
        ->and($noName->errorFields)->toHaveKey('name')
        ->and(Party::query()->count())->toBe(0);
});

it('rejects an id that is already taken', function (): void {
    $first = partyMutation();
    $this->writer->create($this->manager, $first);

    $again = $this->writer->create($this->manager, partyMutation(['id' => $first->id, 'payload' => [...$this->payload, 'allow_duplicate' => true, 'tax_number' => null]]));

    expect($again->status)->toBe(OutcomeStatus::Rejected)
        ->and($again->errorFields)->toHaveKey('id');
});

it('refuses a caller without parties.create and reveals no candidates', function (): void {
    $this->writer->create($this->manager, partyMutation());

    $outcome = $this->writer->create($this->viewer, partyMutation());

    expect($outcome->status)->toBe(OutcomeStatus::Rejected)
        ->and($outcome->errorCode)->toBe(ErrorCode::Forbidden);
});

it('rejects the tax number of an active party instead of offering an impossible keep_mine', function (): void {
    $this->writer->create($this->manager, partyMutation());
    $resolution = ['resolves' => (string) Str::uuid7(), 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine'];

    $plain = $this->writer->create($this->manager, partyMutation(['payload' => [...$this->payload, 'name' => 'Totally Different']]));
    $kept = $this->writer->create($this->manager, partyMutation(['resolution' => $resolution, 'payload' => [...$this->payload, 'name' => 'Totally Different']]));

    expect($plain->status)->toBe(OutcomeStatus::Rejected)
        ->and($plain->errorCode)->toBe(ErrorCode::ValidationError)
        ->and($plain->errorFields)->toHaveKey('tax_number')
        ->and($plain->conflict)->toBeNull()
        ->and($kept->status)->toBe(OutcomeStatus::Rejected)
        ->and($kept->errorFields)->toHaveKey('tax_number')
        ->and(Party::query()->count())->toBe(1);
});

it('answers DUPLICATE_RECORD for the tax number of an inactive party and keep_mine then succeeds', function (): void {
    $existing = partyMutation();
    $this->writer->create($this->manager, $existing);
    DB::table('parties')->update(['is_active' => false]);
    $mine = partyMutation(['payload' => [...$this->payload, 'name' => 'Totally Different']]);

    $outcome = $this->writer->create($this->manager, $mine);
    $kept = $this->writer->create($this->manager, partyMutation([
        'id' => $mine->id,
        'payload' => $mine->payload,
        'resolution' => ['resolves' => $mine->idempotencyKey, 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine'],
    ]));

    expect($outcome->status)->toBe(OutcomeStatus::Conflict)
        ->and($outcome->conflict->code)->toBe(ErrorCode::DuplicateRecord)
        ->and($outcome->conflict->candidates)->toBe([$existing->id])
        ->and(array_map(fn ($c) => $c->value, $outcome->conflict->choices))->toBe(['use_existing', 'keep_mine', 'discard'])
        ->and($kept->status)->toBe(OutcomeStatus::Applied)
        ->and(Party::query()->count())->toBe(2);
});

it('shows no candidates to a caller without parties.view and creates as REST POST does', function (): void {
    $existing = partyMutation();
    $this->writer->create($this->manager, $existing);
    $creator = Actors::user(['parties.create'], $this->company);

    $outcome = $this->writer->create($creator, partyMutation(['payload' => ['name' => 'Acme Teknoloji', 'type' => 'person', 'roles' => ['customer']]]));

    expect($outcome->status)->toBe(OutcomeStatus::Applied)
        ->and($outcome->conflict)->toBeNull()
        ->and(json_encode($outcome->data))->not->toContain($existing->id)
        ->and(Party::query()->count())->toBe(2);
});

it('answers DUPLICATE_RECORD for a similar name', function (): void {
    $existing = partyMutation();
    $this->writer->create($this->manager, $existing);

    $outcome = $this->writer->create($this->manager, partyMutation(['payload' => ['name' => 'Acme Teknoloji', 'type' => 'person', 'roles' => ['customer']]]));

    expect($outcome->status)->toBe(OutcomeStatus::Conflict)
        ->and($outcome->conflict->candidates)->toContain($existing->id);
});

it('never skips the duplicate check for an allow_duplicate flag', function (): void {
    $existing = partyMutation();
    $this->writer->create($this->manager, $existing);
    $mutation = partyMutation(['payload' => ['name' => 'Acme Teknoloji', 'type' => 'person', 'roles' => ['customer'], 'allow_duplicate' => true]]);

    $outcome = $this->writer->create($this->manager, $mutation);

    expect($outcome->status)->toBe(OutcomeStatus::Conflict)
        ->and($outcome->conflict->code)->toBe(ErrorCode::DuplicateRecord)
        ->and($outcome->conflict->candidates)->toContain($existing->id)
        ->and(Party::query()->count())->toBe(1);
});

it('skips the duplicate check for a keep_mine resolution but keeps the other rules', function (): void {
    $this->writer->create($this->manager, partyMutation());
    $resolution = ['resolves' => (string) Str::uuid7(), 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine'];

    $similar = $this->writer->create($this->manager, partyMutation(['resolution' => $resolution, 'payload' => ['name' => 'Acme Teknoloji', 'type' => 'person', 'roles' => ['customer']]]));
    $sameTax = $this->writer->create($this->manager, partyMutation(['resolution' => $resolution]));

    expect($similar->status)->toBe(OutcomeStatus::Applied)
        ->and($sameTax->status)->toBe(OutcomeStatus::Rejected)
        ->and($sameTax->errorFields)->toHaveKey('tax_number');
});

it('does not allow offline update, delete or action', function (): void {
    $created = partyMutation();
    $this->writer->create($this->manager, $created);
    $party = Party::query()->findOrFail($created->id);

    expect($this->writer->update($this->manager, $created, $party, 1)->errorCode)->toBe(ErrorCode::SyncOfflineWriteNotAllowed)
        ->and($this->writer->delete($this->manager, $created, $party, 1)->errorCode)->toBe(ErrorCode::SyncOfflineWriteNotAllowed)
        ->and($this->writer->find($created->id)?->getKey())->toBe($created->id)
        ->and($this->writer->currentVersion($party))->toBe(1);
});

it('logs the version in the activity log', function (): void {
    $mutation = partyMutation();
    $this->writer->create($this->manager, $mutation);

    $log = Activity::query()->where('subject_id', $mutation->id)->where('event', 'created')->first();

    expect($log)->not->toBeNull()
        ->and($log->attribute_changes['attributes']['version'] ?? null)->toBe(1)
        ->and($this->writer->auditFields())->toContain('version', 'name');
});

/**
 * Simulates a concurrent request that inserts the same id after validation has passed.
 */
function raceInsertSameId(): void
{
    $raced = false;
    Party::creating(function (Party $party) use (&$raced): void {
        if ($raced) {
            return;
        }
        $raced = true;
        $party->replicate()->forceFill(['id' => $party->id, 'company_id' => app(CompanyContext::class)->id(), 'code' => 'RACE-1', 'tax_number' => null, 'is_active' => false])->saveQuietly();
    });
}

it('maps a lost client id insert race to a validation error on id', function (): void {
    raceInsertSameId();
    $outcome = $this->writer->create($this->manager, partyMutation());

    expect($outcome->status)->toBe(OutcomeStatus::Rejected)
        ->and($outcome->errorCode)->toBe(ErrorCode::ValidationError)
        ->and($outcome->errorFields)->toHaveKey('id')
        ->and(Party::query()->count())->toBe(0);

    raceInsertSameId();
    $headers = ['Accept' => 'application/json', 'X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid7()];
    $this->actingAs($this->manager, 'sanctum')
        ->postJson('/api/v1/parties', [...$this->payload, 'id' => (string) Str::uuid7()], $headers)
        ->assertUnprocessable()
        ->assertJsonPath('errors.code', 'VALIDATION_ERROR')
        ->assertJsonStructure(['errors' => ['fields' => ['id']]]);
    expect(Party::query()->count())->toBe(0);
});

it('accepts a client id on REST POST and keeps PATCH and codes as before', function (): void {
    $id = (string) Str::uuid7();
    $headers = ['Accept' => 'application/json', 'X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid7()];

    $created = $this->actingAs($this->manager, 'sanctum')->postJson('/api/v1/parties', [...$this->payload, 'id' => $id], $headers);
    $plain = $this->actingAs($this->manager, 'sanctum')->postJson('/api/v1/parties', [...$this->payload, 'tax_number' => null, 'name' => 'Other'], [...$headers, 'Idempotency-Key' => (string) Str::uuid7()]);
    $notV7 = $this->actingAs($this->manager, 'sanctum')->postJson('/api/v1/parties', [...$this->payload, 'tax_number' => null, 'id' => (string) Str::uuid()], [...$headers, 'Idempotency-Key' => (string) Str::uuid7()]);

    $created->assertCreated()->assertJsonPath('data.id', $id);
    $plain->assertCreated();
    $notV7->assertUnprocessable();
    expect($notV7->getContent())->toContain('"id"');
    expect(DB::table('parties')->count())->toBe(2);
});

it('never leaks sync_txid into REST or sync party JSON', function (): void {
    $mutation = partyMutation();
    $outcome = $this->writer->create($this->manager, $mutation);
    $party = Party::query()->findOrFail($mutation->id);
    $party->addresses()->create(['type' => 'billing', 'line1' => 'Sok 1', 'country' => 'TR']);
    $party->contacts()->create(['name' => 'Ayse']);
    $party->bankAccounts()->create(['bank_name' => 'Banka', 'iban' => 'TR330006100519786457841326']);
    $headers = ['Accept' => 'application/json', 'X-Company-Id' => $this->company];

    $show = $this->actingAs($this->manager, 'sanctum')->getJson("/api/v1/parties/{$party->id}", $headers)->assertOk();
    $index = $this->actingAs($this->manager, 'sanctum')->getJson('/api/v1/parties', $headers)->assertOk();
    $children = $this->actingAs($this->manager, 'sanctum')->getJson("/api/v1/parties/{$party->id}/addresses", $headers)->assertOk();

    expect($outcome->data)->not->toHaveKey('sync_txid')
        ->and($show->getContent())->not->toContain('sync_txid')
        ->and($index->getContent())->not->toContain('sync_txid')
        ->and($children->getContent())->not->toContain('sync_txid')
        ->and($show->json('data.addresses'))->toHaveCount(1);
});
