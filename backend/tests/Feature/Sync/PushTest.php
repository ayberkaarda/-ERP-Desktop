<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Rules\ClientKey;
use App\Core\Sync\WriteOutcome;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\ScriptedNoteWriter;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;

uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor();
    $this->headers = SyncKit::headers($this->user, $this->company);
});

/**
 * @param  list<array<string, mixed>>  $mutations
 * @return list<array<string, mixed>>
 */
function pushAll(object $test, array $mutations, ?array $headers = null): array
{
    $response = SyncKit::push($test, $mutations, $headers ?? $test->headers)->assertOk();

    return SyncKit::wire($response, 'sync/push.response.schema.json')['data']['results'];
}

/**
 * @param  array<string, mixed>  $mutation
 * @return array<string, mixed>
 */
function pushOne(object $test, array $mutation, ?array $headers = null): array
{
    return pushAll($test, [$mutation], $headers)[0];
}

function newId(): string
{
    return (string) Str::uuid7();
}

it('applies a create with the client id and replays it as duplicate', function (): void {
    $id = newId();
    $create = SyncKit::mutation('create', $id, ['title' => 'Offline', 'lines' => [['body' => 'one'], ['body' => 'two']]]);

    $result = pushOne($this, $create);

    expect($result)->toMatchArray(['idempotency_key' => $create['idempotency_key'], 'resource' => 'fixture-notes', 'id' => $id, 'status' => 'applied', 'replayed' => false, 'version' => 1])
        ->and($result['data']['id'])->toBe($id)
        ->and(array_column($result['data']['lines'], 'body'))->toBe(['one', 'two'])
        ->and(FixtureNote::withoutCompanyScope()->find($id)?->company_id)->toBe($this->company->id);

    // The row changes on the server; the replay still answers the stored first result.
    SyncKit::serverEdit($this->company, FixtureNote::withoutCompanyScope()->findOrFail($id), fn (FixtureNote $n) => $n->update(['title' => 'Web edit']));
    $again = pushOne($this, $create);

    expect($again)->toMatchArray(['status' => 'duplicate', 'replayed' => true, 'version' => 1])
        ->and($again['data'])->toBe($result['data'])
        ->and(FixtureNote::withoutCompanyScope()->count())->toBe(1);

    $reused = pushOne($this, [...$create, 'payload' => ['title' => 'Different']]);
    expect($reused)->toMatchArray(['status' => 'rejected', 'replayed' => false])
        ->and($reused['error']['code'])->toBe('IDEMPOTENCY_KEY_REUSED');
});

it('stores rejections and replays them with the same status', function (): void {
    $bad = SyncKit::mutation('create', newId(), ['title' => 'reject']);

    $first = pushOne($this, $bad);
    $again = pushOne($this, $bad);

    expect($first)->toMatchArray(['status' => 'rejected', 'replayed' => false])
        ->and($first['error']['code'])->toBe('VALIDATION_ERROR')
        ->and($first['error']['fields'])->toHaveKey('title')
        ->and($again)->toMatchArray(['status' => 'rejected', 'replayed' => true])
        ->and($again['error'])->toBe($first['error']);
});

it('refuses a create whose id is taken, in this company or another', function (): void {
    $mine = SyncKit::note($this->company);
    [$other] = SyncKit::actor();
    $foreign = SyncKit::note($other);

    foreach ([$mine->id, $foreign->id] as $id) {
        $result = pushOne($this, SyncKit::mutation('create', $id, ['title' => 'Taken']));
        expect($result['status'])->toBe('rejected')
            ->and($result['error']['code'])->toBe('VALIDATION_ERROR')
            ->and(array_keys($result['error']['fields']))->toBe(['id']);
    }

    expect(FixtureNote::withoutCompanyScope()->findOrFail($foreign->id)->title)->toBe('Note');
});

it('turns a concurrent insert of the same id into VALIDATION_ERROR on id', function (): void {
    $id = newId();
    // Another request commits the same id between our lock and our insert.
    ScriptedNoteWriter::$beforeCreate = function () use ($id): null {
        DB::table('sync_fixture_notes')->insert(['id' => $id, 'company_id' => $this->company->id, 'title' => 'Racer', 'status' => 'draft', 'version' => 1, 'created_at' => Carbon::now(), 'updated_at' => Carbon::now()]);

        return null;
    };

    $create = SyncKit::mutation('create', $id, ['title' => 'Mine']);
    $result = pushOne($this, $create);

    expect($result['status'])->toBe('rejected')
        ->and($result['error']['code'])->toBe('VALIDATION_ERROR')
        ->and(array_keys($result['error']['fields']))->toBe(['id'])
        ->and(DB::table('sync_fixture_notes')->where('id', $id)->exists())->toBeFalse();

    ScriptedNoteWriter::$beforeCreate = null;
    expect(pushOne($this, $create))->toMatchArray(['status' => 'rejected', 'replayed' => true]);
});

it('refuses writes outside the manifest write definition', function (): void {
    $note = SyncKit::note($this->company);
    $another = SyncKit::note($this->company);

    $results = pushAll($this, [
        SyncKit::mutation('create', newId(), ['title' => 'x'], overrides: ['resource' => 'nope']),
        SyncKit::mutation('create', newId(), ['title' => 'x'], overrides: ['resource' => 'fixture-dated-notes']),
        SyncKit::mutation('action', $note->id, ['title' => 'x'], 1, ['action' => 'archive']),
        SyncKit::mutation('update', $another->id, ['status' => 'closed'], 1),
    ]);

    expect(array_map(fn (array $r): string => $r['error']['code'], $results))->toBe([
        'SYNC_RESOURCE_UNSUPPORTED',
        'SYNC_OFFLINE_WRITE_NOT_ALLOWED',
        'SYNC_OFFLINE_WRITE_NOT_ALLOWED',
        'SYNC_OFFLINE_WRITE_NOT_ALLOWED',
    ]);
});

it('checks payload and target constraints', function (): void {
    SyncKit::manifest(function (array $m): array {
        $m['resources'][0]['write']['payload_constraints'] = ['title' => ['Allowed', 'Also allowed']];
        $m['resources'][0]['write']['target_constraints'] = ['status' => ['draft', 'review']];

        return $m;
    });
    $draft = SyncKit::note($this->company);
    $closed = SyncKit::note($this->company, ['status' => 'closed']);
    $closedToo = SyncKit::note($this->company, ['status' => 'closed']);
    $review = SyncKit::note($this->company, ['status' => 'review']);

    $results = pushAll($this, [
        SyncKit::mutation('create', newId(), ['title' => 'Other']),
        SyncKit::mutation('create', newId(), ['title' => 'Allowed']),
        SyncKit::mutation('update', $draft->id, ['title' => 'Also allowed'], 1),
        SyncKit::mutation('update', $closed->id, ['title' => 'Allowed'], 1),
        SyncKit::mutation('delete', $closedToo->id, [], 1),
        SyncKit::mutation('update', $review->id, ['title' => 'Allowed'], 1),
    ]);

    expect(array_column($results, 'status'))->toBe(['rejected', 'applied', 'applied', 'rejected', 'rejected', 'conflict'])
        ->and($results[0]['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and($results[3]['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and($results[4]['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and($results[5]['conflict']['code'])->toBe('DOCUMENT_LOCKED');
});

it('authorizes with current permissions before any stored result and stores no refusal', function (): void {
    [$company, $viewer] = SyncKit::actor(['fixtures.view']);
    $headers = SyncKit::headers($viewer, $company);
    $create = SyncKit::mutation('create', newId(), ['title' => 'Mine']);

    expect(pushOne($this, $create, $headers)['error']['code'])->toBe('FORBIDDEN');

    Actors::grant($viewer, $company->id, ['fixtures.view', 'fixtures.create']);
    expect(pushOne($this, $create, $headers))->toMatchArray(['status' => 'applied', 'replayed' => false]);

    // Losing the permission: the stored result is not served.
    Actors::revoke($viewer, $company->id);
    Actors::grant($viewer, $company->id, ['fixtures.create']);
    $replay = pushOne($this, $create, $headers);
    expect($replay)->toMatchArray(['status' => 'rejected', 'replayed' => false])
        ->and($replay['error']['code'])->toBe('FORBIDDEN');
});

it('hides rows of other companies and unknown ids behind NOT_FOUND', function (): void {
    [$other] = SyncKit::actor();
    $foreign = SyncKit::note($other);

    $results = pushAll($this, [
        SyncKit::mutation('update', $foreign->id, ['title' => 'x'], 1),
        SyncKit::mutation('delete', $foreign->id, [], 1),
        SyncKit::mutation('update', newId(), ['title' => 'x'], 1),
    ]);

    expect(array_map(fn (array $r): string => $r['error']['code'], $results))->toBe(['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'])
        ->and(FixtureNote::withoutCompanyScope()->findOrFail($foreign->id)->title)->toBe('Note');
});

it('applies update, action and delete on the current version', function (): void {
    $note = SyncKit::note($this->company, [], ['old line']);

    $results = pushAll($this, [
        SyncKit::mutation('update', $note->id, ['title' => 'Renamed', 'lines' => [['body' => 'new line']]], 1),
        SyncKit::mutation('action', $note->id, ['title' => 'ignored by close'], 2, ['action' => 'close']),
    ]);

    expect($results[0])->toMatchArray(['status' => 'applied', 'version' => 2])
        ->and($results[0])->not->toHaveKey('merged_fields')
        ->and($results[0]['data']['title'])->toBe('Renamed')
        ->and(array_column($results[0]['data']['lines'], 'body'))->toBe(['new line'])
        ->and($results[1])->toMatchArray(['status' => 'applied', 'version' => 3])
        ->and($results[1]['data']['status'])->toBe('closed');

    $draft = SyncKit::note($this->company);
    $delete = SyncKit::mutation('delete', $draft->id, [], 1);
    $deleted = pushOne($this, $delete);

    expect($deleted)->toMatchArray(['status' => 'applied', 'data' => null, 'replayed' => false])
        ->and($deleted)->not->toHaveKey('version')
        ->and(FixtureNote::withoutCompanyScope()->find($draft->id))->toBeNull();

    // The row is gone; the replay still answers the stored delete.
    expect(pushOne($this, $delete))->toMatchArray(['status' => 'duplicate', 'data' => null, 'replayed' => true]);
});

it('rejects mismatched changed_fields, a base version ahead and malformed mutations', function (): void {
    $note = SyncKit::note($this->company);
    $another = SyncKit::note($this->company);

    $results = pushAll($this, [
        SyncKit::mutation('update', $note->id, ['title' => 'x'], 1, ['changed_fields' => ['title', 'lines']]),
        SyncKit::mutation('update', $another->id, ['title' => 'x'], 5),
        SyncKit::mutation('create', newId(), ['title' => 'x'], overrides: ['base_version' => 3]),
        SyncKit::mutation('create', newId(), ['title' => 'x', 'version' => 1]),
        SyncKit::mutation('delete', $note->id, ['title' => 'x'], 1),
        SyncKit::mutation('create', newId(), ['title' => 'x'], overrides: ['occurred_at' => 'now']),
    ]);

    expect(array_map(fn (array $r): string => $r['error']['code'], $results))->toBe([
        'SYNC_CHANGED_FIELDS_MISMATCH',
        'SYNC_BASE_VERSION_AHEAD',
        'VALIDATION_ERROR',
        'VALIDATION_ERROR',
        'VALIDATION_ERROR',
        'VALIDATION_ERROR',
    ])->and(FixtureNote::withoutCompanyScope()->findOrFail($note->id)->title)->toBe('Note');
});

it('fails dependent mutations instead of trying them', function (): void {
    $note = SyncKit::note($this->company);
    $bad = SyncKit::mutation('update', $note->id, ['title' => 'reject'], 1);
    $later = SyncKit::mutation('update', $note->id, ['title' => 'x'], 1);
    $other = SyncKit::mutation('create', newId(), ['title' => 'x'], overrides: ['depends_on' => [$bad['idempotency_key']]]);
    $forward = SyncKit::mutation('create', newId(), ['title' => 'x']);
    $pointsForward = SyncKit::mutation('create', newId(), ['title' => 'x'], overrides: ['depends_on' => [$forward['idempotency_key']]]);
    $unknown = SyncKit::mutation('create', newId(), ['title' => 'x'], overrides: ['depends_on' => [newId()]]);

    $results = pushAll($this, [$bad, $later, $other, $pointsForward, $forward, $unknown]);

    expect(array_column($results, 'status'))->toBe(['rejected', 'rejected', 'rejected', 'rejected', 'applied', 'rejected'])
        ->and(array_map(fn (array $r): ?string => $r['error']['code'] ?? null, $results))->toBe([
            'VALIDATION_ERROR', 'SYNC_DEPENDENCY_FAILED', 'SYNC_DEPENDENCY_FAILED', 'VALIDATION_ERROR', null, 'VALIDATION_ERROR',
        ])
        ->and(array_keys($results[3]['error']['fields']))->toBe(['depends_on']);

    // A key applied in an earlier batch satisfies depends_on.
    $next = SyncKit::mutation('create', newId(), ['title' => 'y'], overrides: ['depends_on' => [$forward['idempotency_key']]]);
    expect(pushOne($this, $next)['status'])->toBe('applied');
});

it('refuses oversized batches, unknown schema versions and unanswerable mutations as a whole', function (): void {
    config(['sync.limits.push_batch_max' => 2]);
    $m = fn (): array => SyncKit::mutation('create', newId(), ['title' => 'x']);

    $tooLarge = SyncKit::push($this, [$m(), $m(), $m()], $this->headers)->assertStatus(413);
    $mismatch = SyncKit::post($this, 'push', ['schema_version' => 2, 'mutations' => [$m()]], $this->headers)->assertStatus(409);
    $broken = SyncKit::push($this, [[...$m(), 'idempotency_key' => 'not-a-key']], $this->headers)->assertStatus(422);

    expect(SyncKit::wire($tooLarge, 'sync/error.response.schema.json')['errors']['code'])->toBe('SYNC_BATCH_TOO_LARGE')
        ->and(SyncKit::wire($mismatch, 'sync/error.response.schema.json')['errors']['code'])->toBe('SYNC_SCHEMA_MISMATCH')
        ->and(SyncKit::wire($broken, 'sync/error.response.schema.json')['errors']['code'])->toBe('VALIDATION_ERROR')
        ->and(FixtureNote::withoutCompanyScope()->count())->toBe(0);
});

it('keeps the batch non-atomic: one failure does not undo the others', function (): void {
    $results = pushAll($this, [
        SyncKit::mutation('create', newId(), ['title' => 'First']),
        SyncKit::mutation('create', newId(), ['title' => 'reject']),
        SyncKit::mutation('create', newId(), ['title' => 'Third']),
    ]);

    expect(array_column($results, 'status'))->toBe(['applied', 'rejected', 'applied'])
        ->and(app(CompanyContext::class)->runAs($this->company->id, fn () => FixtureNote::query()->orderBy('title')->pluck('title')->all()))->toBe(['First', 'Third']);
});

it('does not wait on the row lock of another company', function (): void {
    [$other] = SyncKit::actor();
    $foreign = SyncKit::note($other);
    config(['database.connections.sync_lock' => config('database.connections.'.config('database.default'))]);
    $holder = DB::connection('sync_lock');
    $holder->beginTransaction();
    $holder->select('SELECT id FROM sync_fixture_notes WHERE id = ? FOR UPDATE', [$foreign->id]);
    DB::statement("SET lock_timeout = '1s'");

    try {
        $results = pushAll($this, [
            SyncKit::mutation('update', $foreign->id, ['title' => 'x'], 1),
            SyncKit::mutation('delete', $foreign->id, [], 1),
            SyncKit::mutation('create', $foreign->id, ['title' => 'x']),
        ]);
    } finally {
        DB::statement('RESET lock_timeout');
        $holder->rollBack();
        $holder->disconnect();
    }

    expect(array_map(fn (array $r): string => $r['error']['code'], $results))->toBe(['NOT_FOUND', 'NOT_FOUND', 'VALIDATION_ERROR'])
        ->and($results[2]['error']['fields'])->toBe(['id' => [ClientKey::message()]])
        ->and($results[2])->not->toHaveKey('data');
});

it('stores nothing for transient writer errors and keeps their headers', function (): void {
    $note = SyncKit::note($this->company);
    $update = SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1);

    ScriptedNoteWriter::$replaceUpdate = static fn (): WriteOutcome => throw new ApiException(ErrorCode::TooManyAttempts, headers: ['Retry-After' => '30']);
    $limited = SyncKit::push($this, [$update], $this->headers)->assertStatus(429)->assertHeader('Retry-After', '30');
    expect(SyncKit::wire($limited, 'sync/error.response.schema.json')['errors']['code'])->toBe('TOO_MANY_ATTEMPTS');

    ScriptedNoteWriter::$replaceUpdate = static fn (): WriteOutcome => WriteOutcome::rejected(ErrorCode::ServerError);
    $failed = SyncKit::push($this, [$update], $this->headers)->assertStatus(500);
    expect(SyncKit::wire($failed, 'sync/error.response.schema.json')['errors']['code'])->toBe('SERVER_ERROR')
        ->and(DB::table('idempotency_keys')->where('key', $update['idempotency_key'])->exists())->toBeFalse();

    ScriptedNoteWriter::$replaceUpdate = null;
    expect(pushOne($this, $update))->toMatchArray(['status' => 'applied', 'replayed' => false, 'version' => 2]);
});
