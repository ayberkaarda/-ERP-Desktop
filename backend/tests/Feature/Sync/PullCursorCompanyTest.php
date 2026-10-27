<?php

declare(strict_types=1);

use App\Core\Sync\Cursor;
use App\Modules\Organization\Models\Company;
use App\Modules\Sync\Services\CursorTags;
use App\Modules\Sync\Services\PullService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;

/*
 * An incremental cursor belongs to the stream of one (user, company, resource). Its session
 * carries a stateless stream tag (i_ + HMAC over user, company, resource and position). A cursor
 * presented in another company, by another user, with a changed position or a forged tag, or
 * with no tag at all (an old client) resets with cursor_expired; the owner's cursor continues,
 * however often it is retried, and nothing is stored per pull.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view']);
    $this->headers = SyncKit::headers($this->user, $this->company);
});

/**
 * @param  array<string, mixed>|null  $cursor
 * @param  array<string, string>  $headers
 * @return array<string, mixed>
 */
function companyCursorPull(object $test, ?array $cursor, array $headers, ?int $limit = null): array
{
    $request = ['resource' => 'fixture-notes', 'cursor' => $cursor];

    if ($limit !== null) {
        $request['limit'] = $limit;
    }

    $response = SyncKit::pull($test, [$request], $headers)->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];
}

/**
 * @param  array<string, mixed>  $cursor
 * @return array<string, mixed>
 */
function companyCursorRetag(array $cursor, string $userId, string $companyId): array
{
    $position = array_diff_key($cursor, ['session' => 0]);

    return [...$cursor, 'session' => app(CursorTags::class)->issue($userId, $companyId, 'fixture-notes', Cursor::fromWire($position))];
}

/** @param  array<string, mixed>  $page */
function companyCursorExpired(array $page): void
{
    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'] ?? null)->toBe('cursor_expired');
}

it('resets an incremental cursor of company A presented under company B', function (): void {
    $other = Actors::company();
    Actors::grant($this->user, $other, ['fixtures.view']);
    SyncKit::note($this->company, ['title' => 'Own company']);
    // B's row commits before A's cursor is issued: a continuation in B would skip it.
    SyncKit::note(Company::query()->findOrFail($other), ['title' => 'Other company']);
    SyncKit::waitVisible();
    $cursorA = companyCursorPull($this, null, $this->headers)['next_cursor'];
    expect($cursorA['session'])->toStartWith('i_');

    $page = companyCursorPull($this, $cursorA, [...$this->headers, 'X-Company-Id' => $other]);

    companyCursorExpired($page);
    expect(array_column($page['rows'], 'title'))->toBe(['Other company']);
});

it('resets a position company B issued itself when it carries the tag company A gives that position', function (): void {
    $other = Actors::company();
    Actors::grant($this->user, $other, ['fixtures.view']);
    $headersB = [...$this->headers, 'X-Company-Id' => $other];
    SyncKit::note(Company::query()->findOrFail($other), ['title' => 'Other company']);
    SyncKit::waitVisible();
    $cursorB = companyCursorPull($this, null, $headersB)['next_cursor'];

    // Same txid/after_id/gen as B's own cursor, tagged for A: exactly what A holds when both
    // companies were pulled at the same horizon and generation.
    $asA = companyCursorRetag($cursorB, $this->user->id, $this->company->id);
    expect(array_diff_key($asA, ['session' => 0]))->toBe(array_diff_key($cursorB, ['session' => 0]))
        ->and($asA['session'])->not->toBe($cursorB['session']);

    companyCursorExpired(companyCursorPull($this, $asA, $headersB));
    expect(companyCursorPull($this, $cursorB, $headersB)['reset'])->toBeFalse();
});

it('resets the cursor of another user of the same company and continues the owner\'s', function (): void {
    SyncKit::note($this->company, ['title' => 'Shared']);
    SyncKit::waitVisible();
    $cursor = companyCursorPull($this, null, $this->headers)['next_cursor'];
    $colleague = Actors::user(['fixtures.view'], $this->company->id);

    companyCursorExpired(companyCursorPull($this, $cursor, SyncKit::headers($colleague, $this->company)));
    expect(companyCursorPull($this, $cursor, $this->headers)['reset'])->toBeFalse();
});

it('resets a changed tag, a tag moved to another position and an unknown session value, never 422', function (): void {
    $note = SyncKit::note($this->company, ['title' => 'Tagged']);
    SyncKit::waitVisible();
    $cursor = companyCursorPull($this, null, $this->headers)['next_cursor'];
    $tag = (string) $cursor['session'];
    $flipped = substr($tag, 0, -1).(str_ends_with($tag, 'A') ? 'B' : 'A');

    $forged = [
        'changed tag' => [...$cursor, 'session' => $flipped],
        'tag of another position' => [...$cursor, 'after_id' => (string) Str::uuid7()],
        'tag of another txid' => [...$cursor, 'txid' => (string) DB::table('sync_fixture_notes')->where('id', $note->id)->value('sync_txid')],
        'unknown session value' => [...$cursor, 'session' => 'abc'],
    ];

    foreach ($forged as $case => $value) {
        $response = SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $value]], $this->headers);
        expect($response->status())->toBe(200, $case);
        companyCursorExpired(SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0]);
    }

    expect(companyCursorPull($this, $cursor, $this->headers)['reset'])->toBeFalse();
});

it('continues the same tagged cursor on every retry, with any limit', function (): void {
    SyncKit::note($this->company, ['title' => 'First']);
    SyncKit::waitVisible();
    $cursor = companyCursorPull($this, null, $this->headers)['next_cursor'];
    SyncKit::note($this->company, ['title' => 'Second']);
    SyncKit::waitVisible();

    $first = companyCursorPull($this, $cursor, $this->headers);
    $second = companyCursorPull($this, $cursor, $this->headers);
    $other = companyCursorPull($this, $cursor, $this->headers, 1);

    expect([$first['reset'], $second['reset'], $other['reset']])->toBe([false, false, false])
        ->and(array_column($first['rows'], 'title'))->toBe(['Second'])
        ->and(array_column($second['rows'], 'title'))->toBe(['Second'])
        ->and(array_column($other['rows'], 'title'))->toBe(['Second'])
        // The horizon may move between the retries; each answer's cursor is tagged and continues.
        ->and(companyCursorPull($this, $second['next_cursor'], $this->headers)['reset'])->toBeFalse();
});

it('stores nothing per pull: fifty empty incremental pulls leave the session table as it was', function (): void {
    SyncKit::waitVisible();
    $cursor = companyCursorPull($this, null, $this->headers)['next_cursor'];
    $sessions = DB::table('sync_full_downloads')->count();

    for ($i = 0; $i < 50; $i++) {
        $page = companyCursorPull($this, $cursor, $this->headers);
        expect($page['reset'])->toBeFalse();
        $cursor = $page['next_cursor'];
    }

    expect(DB::table('sync_full_downloads')->count())->toBe($sessions)
        ->and(Schema::hasTable('sync_cursor_scopes'))->toBeFalse();
});

it('resets an untagged incremental cursor of an old client once and continues the tagged one it gets', function (): void {
    SyncKit::note($this->company, ['title' => 'Old client']);
    SyncKit::waitVisible();
    $cursor = companyCursorPull($this, null, $this->headers)['next_cursor'];

    $reset = companyCursorPull($this, [...$cursor, 'session' => null], $this->headers);

    companyCursorExpired($reset);
    expect(array_column($reset['rows'], 'title'))->toBe(['Old client'])
        ->and($reset['next_cursor']['session'])->toStartWith('i_')
        ->and(companyCursorPull($this, $reset['next_cursor'], $this->headers)['reset'])->toBeFalse();
});

it('resets every tagged cursor once when the application key changes', function (): void {
    SyncKit::waitVisible();
    $cursor = companyCursorPull($this, null, $this->headers)['next_cursor'];

    app()->instance(CursorTags::class, new CursorTags('base64:'.base64_encode(random_bytes(32))));
    app()->forgetInstance(PullService::class);

    $page = companyCursorPull($this, $cursor, $this->headers);

    companyCursorExpired($page);
    expect(companyCursorPull($this, $page['next_cursor'], $this->headers)['reset'])->toBeFalse();
});

it('derives the tag from the key, the stream and the position only', function (): void {
    $key = 'base64:'.base64_encode(str_repeat('k', 32));
    $tags = new CursorTags($key);
    $position = Cursor::fromWire(['txid' => '42', 'after_id' => null, 'gen' => 0]);
    $tag = $tags->issue('u1', 'c1', 'fixture-notes', $position);

    expect($tag)->toMatch('/\Ai_[A-Za-z0-9_-]{43}\z/')
        ->and((new CursorTags($key))->verify('u1', 'c1', 'fixture-notes', $position, $tag))->toBeTrue()
        ->and($tags->verify('u1', 'c2', 'fixture-notes', $position, $tag))->toBeFalse()
        ->and($tags->verify('u2', 'c1', 'fixture-notes', $position, $tag))->toBeFalse()
        ->and($tags->verify('u1', 'c1', 'other', $position, $tag))->toBeFalse()
        ->and($tags->verify('u1', 'c1', 'fixture-notes', Cursor::fromWire(['txid' => '43', 'after_id' => null, 'gen' => 0]), $tag))->toBeFalse()
        ->and($tags->verify('u1', 'c1', 'fixture-notes', Cursor::fromWire(['txid' => '42', 'after_id' => null, 'gen' => 1]), $tag))->toBeFalse()
        ->and((new CursorTags('base64:'.base64_encode(str_repeat('x', 32))))->verify('u1', 'c1', 'fixture-notes', $position, $tag))->toBeFalse()
        ->and($tags->isTag($tag))->toBeTrue()
        ->and($tags->isTag((string) Str::uuid7()))->toBeFalse();
    expect(fn () => new CursorTags(''))->toThrow(InvalidArgumentException::class);
});
