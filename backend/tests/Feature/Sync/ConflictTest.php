<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Http\ErrorCode;
use App\Core\Sync\Mutation;
use App\Core\Sync\SyncConflict;
use App\Core\Sync\WriteOutcome;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\LoggedNote;
use Tests\Feature\Sync\Support\ScriptedNoteWriter;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\SyncDatabase;

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
function pushBatch(object $test, array $mutations): array
{
    return SyncKit::wire(SyncKit::push($test, $mutations, $test->headers)->assertOk(), 'sync/push.response.schema.json')['data']['results'];
}

/**
 * @param  array<string, mixed>  $mutation
 * @return array<string, mixed>
 */
function pushSingle(object $test, array $mutation): array
{
    return pushBatch($test, [$mutation])[0];
}

/**
 * Note at version 2 after a logged server change of $attributes (version 1 -> 2).
 *
 * @param  array<string, mixed>  $attributes
 */
function serverChanged(object $test, array $attributes, bool $logged = true): FixtureNote
{
    $note = SyncKit::note($test->company, ['title' => 'Base']);
    $note = SyncKit::serverEdit($test->company, $note, fn (FixtureNote $n) => $n->update($attributes));

    if ($logged) {
        SyncKit::logChange($test->company, $note, [...$attributes, 'version' => 2]);
    }

    return $note;
}

/**
 * Draft note at version 3 whose status the server moved to review and back (both logged).
 */
function statusRoundTrip(object $test, bool $logged = true): FixtureNote
{
    $note = SyncKit::note($test->company, ['title' => 'Base']);

    foreach ([['review', 2], ['draft', 3]] as [$status, $version]) {
        $note = SyncKit::serverEdit($test->company, $note, fn (FixtureNote $n) => $n->update(['status' => $status]));

        if ($logged) {
            SyncKit::logChange($test->company, $note, ['status' => $status, 'version' => $version]);
        }
    }

    return $note;
}

function freshNote(string $id): FixtureNote
{
    return FixtureNote::withoutCompanyScope()->with('lines')->findOrFail($id);
}

it('merges a stale update whose fields the server did not change', function (): void {
    $note = statusRoundTrip($this);

    $result = pushSingle($this, SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1));

    expect($result)->toMatchArray(['status' => 'applied', 'version' => 4, 'merged_fields' => ['title']])
        ->and($result['data']['title'])->toBe('Mine')
        ->and(freshNote($note->id)->title)->toBe('Mine');
});

it('conflicts when the stale update meets a server change, with the current server row', function (): void {
    $note = serverChanged($this, ['title' => 'Server']);
    $update = SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1);

    $result = pushSingle($this, $update);
    $conflict = $result['conflict'];

    expect($result['status'])->toBe('conflict')
        ->and($conflict)->toMatchArray(['code' => 'VERSION_CONFLICT', 'base_version' => 1, 'server_version' => 2, 'conflicting_fields' => ['title'], 'choices' => ['keep_mine', 'take_server', 'merge']])
        ->and($conflict['server_data']['title'])->toBe('Server')
        ->and($conflict['server_data']['version'])->toBe(2)
        ->and(freshNote($note->id)->title)->toBe('Server');

    // The replay keeps the stored conflict but shows the row as it is now.
    SyncKit::serverEdit($this->company, $note, fn (FixtureNote $n) => $n->update(['title' => 'Server again']));
    $replay = pushSingle($this, $update);

    expect($replay)->toMatchArray(['status' => 'conflict', 'replayed' => true])
        ->and($replay['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'base_version' => 1, 'server_version' => 3, 'conflicting_fields' => ['title']])
        ->and($replay['conflict']['server_data']['title'])->toBe('Server again')
        ->and($replay['conflict']['server_data']['version'])->toBe($replay['conflict']['server_version']);
});

it('treats unknown history and untracked fields as changed', function (): void {
    $unlogged = statusRoundTrip($this, logged: false);
    $logged = statusRoundTrip($this);

    $results = pushBatch($this, [
        SyncKit::mutation('update', $unlogged->id, ['title' => 'Mine'], 1),
        SyncKit::mutation('update', $logged->id, ['lines' => [['body' => 'mine']]], 1),
    ]);

    expect($results[0]['conflict']['conflicting_fields'])->toBe(['title'])
        ->and($results[0]['conflict']['server_version'])->toBe(3)
        ->and($results[1]['conflict']['conflicting_fields'])->toBe(['lines'])
        ->and(freshNote($logged->id)->lines)->toHaveCount(0);
});

it('counts declared derived fields in the write set', function (): void {
    SyncKit::manifest(function (array $m): array {
        $m['resources'][0]['write']['derived_fields'] = [['when' => ['title'], 'derives' => ['status'], 'source' => 'test']];

        return $m;
    });
    $note = statusRoundTrip($this);

    $result = pushSingle($this, SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1));

    expect($result['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'conflicting_fields' => ['status']]);
});

it('rolls a merge back when the service changes an undeclared column', function (): void {
    $note = statusRoundTrip($this);
    ScriptedNoteWriter::$afterUpdate = function (Model $target): void {
        $target->forceFill(['status' => 'review'])->save();
    };

    $result = pushSingle($this, SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1));

    expect($result['status'])->toBe('conflict')
        ->and($result['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'base_version' => 1, 'server_version' => 3, 'conflicting_fields' => ['status']])
        ->and($result['conflict']['server_data']['title'])->toBe('Base')
        ->and(freshNote($note->id)->only(['title', 'status', 'version']))->toBe(['title' => 'Base', 'status' => 'draft', 'version' => 3]);

    // With a current base no check is needed: the same write applies.
    expect(pushSingle($this, SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 3))['status'])->toBe('applied');
});

it('needs the exact version for delete and action', function (): void {
    $note = statusRoundTrip($this);

    $results = pushBatch($this, [
        SyncKit::mutation('delete', $note->id, [], 1),
        SyncKit::mutation('action', SyncKit::note($this->company)->id, ['title' => 'x'], 2, ['action' => 'close']),
    ]);

    expect($results[0]['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'base_version' => 1, 'server_version' => 3, 'conflicting_fields' => [], 'choices' => ['keep_mine', 'take_server']])
        ->and($results[1]['status'])->toBe('rejected')
        ->and($results[1]['error']['code'])->toBe('SYNC_BASE_VERSION_AHEAD')
        ->and(freshNote($note->id)->exists)->toBeTrue();
});

it('answers DOCUMENT_LOCKED before any version check', function (): void {
    $note = SyncKit::note($this->company, ['title' => 'Locked', 'status' => 'closed']);
    SyncKit::serverEdit($this->company, $note, fn (FixtureNote $n) => $n->update(['title' => 'Locked v2']));

    $results = pushBatch($this, [
        SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1),
        SyncKit::mutation('delete', SyncKit::note($this->company, ['status' => 'closed'])->id, [], 1),
        SyncKit::mutation('update', SyncKit::note($this->company, ['status' => 'closed'])->id, ['title' => 'Mine'], 1),
    ]);

    foreach ($results as $result) {
        expect($result['status'])->toBe('conflict')
            ->and($result['conflict']['code'])->toBe('DOCUMENT_LOCKED')
            ->and($result['conflict']['choices'])->toBe(['save_as_new_draft', 'discard'])
            ->and($result['conflict']['server_data']['status'])->toBe('closed');
    }

    expect($results[0]['conflict'])->toMatchArray(['base_version' => 1, 'server_version' => 2])
        ->and($results[0]['conflict']['server_data']['version'])->toBe(2)
        ->and(freshNote($note->id)->title)->toBe('Locked v2');
});

it('resolves DUPLICATE_RECORD with keep_mine once', function (): void {
    $existing = SyncKit::note($this->company, ['title' => 'Twin']);
    $seen = [];
    // Like the Parties writer: the duplicate check is skipped only for a keep_mine resolution,
    // which the writer reads from the mutation it is handed.
    ScriptedNoteWriter::$beforeCreate = static function (Mutation $m) use ($existing, &$seen): ?WriteOutcome {
        $seen[] = $m->resolution?->toArray();

        return $m->resolution === null && ($m->payload['title'] ?? null) === 'Twin'
            ? WriteOutcome::conflict(SyncConflict::duplicateRecord([$existing->id]))
            : null;
    };

    $id = (string) Str::uuid7();
    $create = SyncKit::mutation('create', $id, ['title' => 'Twin']);
    $first = pushSingle($this, $create);

    expect($first['status'])->toBe('conflict')
        ->and($first['conflict'])->toMatchArray(['code' => 'DUPLICATE_RECORD', 'base_version' => null, 'server_version' => null, 'server_data' => null, 'candidates' => [$existing->id], 'choices' => ['use_existing', 'keep_mine', 'discard']])
        ->and(FixtureNote::withoutCompanyScope()->find($id))->toBeNull();

    $resolution = ['resolves' => $create['idempotency_key'], 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine'];
    $keep = SyncKit::mutation('create', $id, ['title' => 'Twin'], overrides: ['resolution' => $resolution]);
    $second = SyncKit::mutation('create', $id, ['title' => 'Twin'], overrides: ['resolution' => $resolution]);
    $wrongId = SyncKit::mutation('create', (string) Str::uuid7(), ['title' => 'Twin'], overrides: ['resolution' => $resolution]);

    // The resolved conflict earlier in the same batch does not block the resolution.
    $results = pushBatch($this, [$create, $wrongId, $keep, $second]);

    expect(array_column($results, 'status'))->toBe(['conflict', 'rejected', 'applied', 'rejected'])
        ->and($results[0]['replayed'])->toBeTrue()
        ->and($results[1]['error']['code'])->toBe('SYNC_RESOLUTION_INVALID')
        ->and($results[2]['data']['id'])->toBe($id)
        ->and($results[3]['error']['code'])->toBe('SYNC_RESOLUTION_INVALID')
        // The writer ran twice (first create, keep_mine); invalid resolutions never reached it.
        ->and($seen)->toBe([null, $resolution]);

    // The resolved key still answers its stored conflict.
    expect(pushSingle($this, $create)['conflict']['code'])->toBe('DUPLICATE_RECORD');
});

it('resolves VERSION_CONFLICT with keep_mine at the server version and refuses invalid resolutions', function (): void {
    $note = serverChanged($this, ['title' => 'Server']);
    $update = SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1);
    $conflict = pushSingle($this, $update)['conflict'];

    $resolution = ['resolves' => $update['idempotency_key'], 'code' => 'VERSION_CONFLICT'];
    $invalid = array_map(fn (array $mutation): array => pushSingle($this, $mutation), [
        SyncKit::mutation('update', $note->id, ['title' => 'Mine'], $conflict['server_version'], ['resolution' => [...$resolution, 'code' => 'DUPLICATE_RECORD', 'choice' => 'keep_mine']]),
        SyncKit::mutation('delete', $note->id, [], $conflict['server_version'], ['resolution' => [...$resolution, 'choice' => 'merge']]),
        SyncKit::mutation('update', $note->id, ['title' => 'Mine'], $conflict['server_version'], ['resolution' => [...$resolution, 'resolves' => (string) Str::uuid7(), 'choice' => 'keep_mine']]),
    ]);

    // In one batch with the conflict it resolves: the resolved mutation does not block it.
    $results = pushBatch($this, [
        $update,
        SyncKit::mutation('update', $note->id, ['title' => 'Mine'], $conflict['server_version'], ['resolution' => [...$resolution, 'choice' => 'keep_mine']]),
    ]);

    expect(array_map(fn (array $r): string => $r['error']['code'], $invalid))->toBe(['SYNC_RESOLUTION_INVALID', 'SYNC_RESOLUTION_INVALID', 'SYNC_RESOLUTION_INVALID'])
        ->and(array_column($results, 'status'))->toBe(['conflict', 'applied'])
        ->and($results[1]['version'])->toBe(3)
        ->and(freshNote($note->id)->title)->toBe('Mine');
});

it('turns REST refusals of the writer into conflicts with the current row', function (string $code, string $expected): void {
    $note = SyncKit::note($this->company, ['title' => 'Base']);
    ScriptedNoteWriter::$replaceUpdate = static fn (): WriteOutcome => WriteOutcome::rejected(ErrorCode::from($code));

    $result = pushSingle($this, SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1));

    expect($result['status'])->toBe('conflict')
        ->and($result['conflict']['code'])->toBe($expected)
        ->and($result['conflict']['server_version'])->toBe(1)
        ->and($result['conflict']['server_data'])->toMatchArray(['id' => $note->id, 'title' => 'Base', 'version' => 1]);
})->with([
    'compare-and-swap lost' => ['VERSION_CONFLICT', 'VERSION_CONFLICT'],
    'REST 409 DOCUMENT_LOCKED' => ['DOCUMENT_LOCKED', 'DOCUMENT_LOCKED'],
]);

it('stores no result when the REST chain itself refuses authorization', function (): void {
    $note = SyncKit::note($this->company, ['title' => 'Base']);
    ScriptedNoteWriter::$replaceUpdate = static fn (): WriteOutcome => WriteOutcome::rejected(ErrorCode::Forbidden);
    $update = SyncKit::mutation('update', $note->id, ['title' => 'Mine'], 1);

    expect(pushSingle($this, $update)['error']['code'])->toBe('FORBIDDEN');

    ScriptedNoteWriter::$replaceUpdate = null;
    expect(pushSingle($this, $update))->toMatchArray(['status' => 'applied', 'replayed' => false]);
});

it('reads the server history from real activity log entries (attribute_changes)', function (): void {
    $edit = function (string $id, array $attributes): void {
        app(CompanyContext::class)->runAs($this->company->id, fn () => LoggedNote::query()->findOrFail($id)->update($attributes));
    };
    $merged = SyncKit::note($this->company, ['title' => 'Base']);
    $edit($merged->id, ['status' => 'review']);
    $edit($merged->id, ['status' => 'draft']);
    $clashing = SyncKit::note($this->company, ['title' => 'Base']);
    $edit($clashing->id, ['title' => 'Server']);

    $entries = DB::table('activity_log')->where('subject_id', $merged->id)->pluck('attribute_changes')->map(fn (string $c): array => json_decode($c, true)['attributes'])->all();
    expect($entries)->toBe([['status' => 'review', 'version' => 2], ['status' => 'draft', 'version' => 3]]);

    $results = pushBatch($this, [
        SyncKit::mutation('update', $merged->id, ['title' => 'Mine'], 1),
        SyncKit::mutation('update', $clashing->id, ['title' => 'Mine'], 1),
    ]);

    expect($results[0])->toMatchArray(['status' => 'applied', 'version' => 4, 'merged_fields' => ['title']])
        ->and($results[1]['conflict'])->toMatchArray(['code' => 'VERSION_CONFLICT', 'server_version' => 2, 'conflicting_fields' => ['title']]);
});
