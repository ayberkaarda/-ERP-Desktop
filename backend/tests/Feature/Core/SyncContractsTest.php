<?php

declare(strict_types=1);

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\ConflictChoice;
use App\Core\Sync\Cursor;
use App\Core\Sync\Mutation;
use App\Core\Sync\MutationOp;
use App\Core\Sync\OutcomeStatus;
use App\Core\Sync\Rules\Uuid7;
use App\Core\Sync\SyncConfig;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\WriteOutcome;
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;

/**
 * @return array<string, mixed>
 */
function wireMutation(array $overrides = []): array
{
    return array_merge([
        'idempotency_key' => '01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e5f',
        'op' => 'update',
        'resource' => 'fixture-notes',
        'id' => '01928c1e-7a2b-7c3d-9e4f-0a1b2c3d4e60',
        'base_version' => 3,
        'changed_fields' => ['title', 'lines'],
        'occurred_at' => '2027-08-01T10:00:00+03:00',
        'payload' => ['title' => 'New', 'lines' => [['body' => 'a']]],
    ], $overrides);
}

it('rejects malformed cursors with SYNC_CURSOR_INVALID', function (mixed $wire): void {
    expect(fn () => Cursor::fromWire($wire))->toThrow(function (ApiException $e): void {
        expect($e->errorCode)->toBe(ErrorCode::SyncCursorInvalid)->and($e->status())->toBe(422);
    });
})->with([
    'not an object' => ['abc'],
    'missing after_id' => [['txid' => '1', 'gen' => 0]],
    'numeric txid' => [['txid' => 1.5, 'after_id' => null, 'gen' => 0]],
    'leading zero' => [['txid' => '01', 'after_id' => null, 'gen' => 0]],
    'bad uuid' => [['txid' => '1', 'after_id' => 'nope', 'gen' => 0]],
    'negative gen' => [['txid' => '1', 'after_id' => null, 'gen' => -1]],
    'extra key' => [['txid' => '1', 'after_id' => null, 'gen' => 0, 'x' => 1]],
]);

it('parses a push mutation', function (): void {
    $m = Mutation::fromArray(wireMutation(['depends_on' => ['01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e61']]));

    expect($m->op)->toBe(MutationOp::Update)
        ->and($m->baseVersion)->toBe(3)
        ->and($m->changedFields)->toBe(['title', 'lines'])
        ->and($m->dependsOn)->toBe(['01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e61'])
        ->and($m->occurredAt->utcOffset())->toBe(180)
        ->and($m->resolution)->toBeNull();

    $resolved = Mutation::fromArray(wireMutation(['resolution' => [
        'resolves' => '01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e62', 'code' => 'VERSION_CONFLICT', 'choice' => 'merge',
    ]]));

    expect($resolved->resolution?->choice)->toBe(ConflictChoice::Merge);
});

it('names the invalid mutation fields', function (array $overrides, string $field): void {
    expect(fn () => Mutation::fromArray(wireMutation($overrides)))->toThrow(function (ApiException $e) use ($field): void {
        expect($e->errorCode)->toBe(ErrorCode::ValidationError)->and($e->fields)->toHaveKey($field);
    });
})->with([
    [['idempotency_key' => '01928c1e-7a2b-4c3d-8e4f-0a1b2c3d4e5f'], 'idempotency_key'],
    [['op' => 'upsert'], 'op'],
    [['resource' => 'Fixture Notes'], 'resource'],
    [['base_version' => 0], 'base_version'],
    [['changed_fields' => ['a', 'a']], 'changed_fields'],
    [['payload' => ['a', 'b']], 'payload'],
    [['occurred_at' => 'yesterday-ish'], 'occurred_at'],
    [['occurred_at' => 'now'], 'occurred_at'],
    [['occurred_at' => 'tomorrow'], 'occurred_at'],
    [['occurred_at' => '2027-02-30T10:00:00+03:00'], 'occurred_at'],
    [['occurred_at' => '2027-08-01T24:00:00Z'], 'occurred_at'],
    [['occurred_at' => '2027-08-01T10:60:00Z'], 'occurred_at'],
    [['occurred_at' => '2027-08-01T10:00:00'], 'occurred_at'],
    [['occurred_at' => '2027-08-01 10:00:00+03:00'], 'occurred_at'],
    [['occurred_at' => '2027-08-01T10:00:00+25:00'], 'occurred_at'],
    [['occurred_at' => "2027-08-01T10:00:00Z\n"], 'occurred_at'],
    [['id' => "01928c1e-7a2b-7c3d-9e4f-0a1b2c3d4e60\n"], 'id'],
    [['depends_on' => ['x']], 'depends_on'],
    [['resolution' => ['resolves' => '01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e62', 'code' => 'DOCUMENT_LOCKED', 'choice' => 'merge']], 'resolution'],
]);

it('fingerprints mutations independent of payload key order', function (): void {
    $a = Mutation::fromArray(wireMutation(['payload' => ['title' => 'New', 'lines' => [['body' => 'a', 'n' => 1]]]]));
    $b = Mutation::fromArray(wireMutation(['payload' => ['lines' => [['n' => 1, 'body' => 'a']], 'title' => 'New']]));
    $c = Mutation::fromArray(wireMutation(['payload' => ['title' => 'Other', 'lines' => [['body' => 'a', 'n' => 1]]]]));

    expect($a->fingerprint())->toBe($b->fingerprint())->not->toBe($c->fingerprint());
});

it('accepts strict RFC 3339 timestamps, with or without fractions', function (string $value): void {
    expect(Mutation::fromArray(wireMutation(['occurred_at' => $value]))->occurredAt->format('Y-m-d'))->toBe('2027-08-01');
})->with(['2027-08-01T10:00:00Z', '2027-08-01T10:00:00.123456+03:00', '2027-08-01T23:59:59-05:30']);

it('gives a retried mutation the same fingerprint whenever it arrives', function (): void {
    $wire = wireMutation();

    try {
        CarbonImmutable::setTestNow('2027-08-01 10:00:00');
        $first = Mutation::fromArray($wire)->fingerprint();
        CarbonImmutable::setTestNow('2027-08-09 18:30:00');
        $retry = Mutation::fromArray($wire)->fingerprint();
    } finally {
        CarbonImmutable::setTestNow();
    }

    expect($retry)->toBe($first);
});

it('serialises outcomes in the push result shape', function (): void {
    $m = Mutation::fromArray(wireMutation());

    expect(WriteOutcome::applied(4, ['id' => $m->id, 'version' => 4], ['title'])->toResult($m))->toBe([
        'idempotency_key' => $m->idempotencyKey,
        'resource' => 'fixture-notes',
        'id' => $m->id,
        'status' => 'applied',
        'version' => 4,
        'data' => ['id' => $m->id, 'version' => 4],
        'merged_fields' => ['title'],
        'replayed' => false,
    ])
        ->and(WriteOutcome::deleted()->toArray())->toBe(['status' => 'applied', 'data' => null])
        ->and(WriteOutcome::rejected(ErrorCode::SyncDependencyFailed)->toArray())->toBe([
            'status' => 'rejected',
            'error' => ['message' => ErrorCode::SyncDependencyFailed->message(), 'code' => 'SYNC_DEPENDENCY_FAILED'],
        ]);

    $conflict = WriteOutcome::conflict(SyncConflict::documentLocked(3, 5, ['id' => $m->id]))->toArray();

    expect($conflict['status'])->toBe('conflict')
        ->and($conflict['conflict']['code'])->toBe('DOCUMENT_LOCKED')
        ->and($conflict['conflict']['choices'])->toBe(['save_as_new_draft', 'discard'])
        ->and($conflict['conflict'])->not->toHaveKey('candidates');
});

it('replays a stored applied outcome as duplicate and the rest as they were', function (): void {
    $m = Mutation::fromArray(wireMutation());
    $stored = [
        WriteOutcome::applied(4, ['id' => $m->id]),
        WriteOutcome::conflict(SyncConflict::versionConflict(3, 5, ['title'], ['id' => $m->id])),
        WriteOutcome::conflict(SyncConflict::duplicateRecord(['01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e70'])),
        WriteOutcome::rejected(ErrorCode::ValidationError, 'bad', ['title' => ['required']]),
    ];

    foreach ($stored as $outcome) {
        $back = WriteOutcome::fromArray(json_decode(json_encode($outcome->toArray(), JSON_THROW_ON_ERROR), true));

        expect($back->toArray())->toBe($outcome->toArray());

        $replayed = $back->replay()->toResult($m, replayed: true);
        $expected = $outcome->status === OutcomeStatus::Applied ? 'duplicate' : $outcome->status->value;

        expect($replayed['status'])->toBe($expected)->and($replayed['replayed'])->toBeTrue();
    }

    expect(SyncConflict::duplicateRecord(['01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e70'])->toArray())
        ->toMatchArray(['base_version' => null, 'server_version' => null, 'server_data' => null, 'choices' => ['use_existing', 'keep_mine', 'discard']]);
});

it('refuses conflict codes outside the protocol', function (): void {
    expect(fn () => new SyncConflict(ErrorCode::ValidationError, null, null, [], null, [ConflictChoice::Discard]))
        ->toThrow(InvalidArgumentException::class)
        ->and(fn () => SyncConflict::duplicateRecord([]))->toThrow(InvalidArgumentException::class);
});

it('validates client ids as lowercase uuidv7', function (string $id, bool $ok): void {
    expect(Validator::make(['id' => $id], ['id' => [new Uuid7]])->passes())->toBe($ok);
})->with([
    ['01928c1e-7a2b-7c3d-8e4f-0a1b2c3d4e5f', true],
    ['01928C1E-7A2B-7C3D-8E4F-0A1B2C3D4E5F', false],
    ['01928c1e-7a2b-4c3d-8e4f-0a1b2c3d4e5f', false],
    ['not-a-uuid', false],
]);

it('reads limits from config/sync.php', function (): void {
    $config = app(SyncConfig::class);

    expect($config->pullResourcesMax)->toBe(32)
        ->and($config->pullPageDefault)->toBe(200)
        ->and($config->pullPageMax)->toBe(1000)
        ->and($config->pushBatchMax)->toBe(200)
        ->and($config->tombstoneRetentionDays)->toBe(90)
        ->and($config->idempotencyRetentionDays)->toBe(7)
        ->and($config->supportsSchema(1))->toBeTrue()
        ->and($config->supportsSchema(2))->toBeFalse()
        ->and($config->manifestPath)->toEndWith('offline-manifest.json');

    config(['sync.limits.push_batch_max' => 50]);
    expect(app(SyncConfig::class)->pushBatchMax)->toBe(50);
});

it('compiles syncable to raw statements and refuses bad identifiers', function (): void {
    $blueprint = new Blueprint(Schema::getConnection(), 'sync_fixture_x');
    $blueprint->create();
    $blueprint->uuid('id')->primary();
    $blueprint->uuid('company_id');
    $blueprint->uuid('owner_id');
    // Composite match: (company_id, owner_id) of the child = (company_id, id) of the parent.
    $blueprint->syncable(parent: 'sync_fixture_parent', parentKey: ['company_id' => 'company_id', 'owner_id'], tracked: true);
    $statements = implode("\n", $blueprint->toSql());

    expect($statements)->toContain('ADD COLUMN sync_txid xid8 NOT NULL DEFAULT pg_current_xact_id()')
        ->toContain('(company_id, sync_txid, id)')
        ->toContain("sync_touch_parent('sync_fixture_parent', 'company_id,owner_id', 'company_id,id')")
        ->toContain("sync_tombstone('owner_id')")
        ->not->toContain('sync_tombstone_soft');

    $bad = new Blueprint(Schema::getConnection(), 'x; drop table users');
    $bad->syncable();

    expect(fn () => $bad->toSql())->toThrow(InvalidArgumentException::class);
});
