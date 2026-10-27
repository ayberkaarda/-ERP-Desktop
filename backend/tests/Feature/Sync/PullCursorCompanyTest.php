<?php

declare(strict_types=1);

use App\Modules\Organization\Models\Company;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;

/*
 * A cursor is a position in the stream of one (user, company, resource). An incremental cursor
 * issued in company A and presented under company B is not a continuation there: the resource
 * resets (cursor_expired) and the reset page brings B's rows, whatever txid the cursor carries.
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
function companyCursorPull(object $test, ?array $cursor, array $headers): array
{
    $response = SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => $cursor]], $headers)->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];
}

it('resets an incremental cursor of company A presented under company B', function (): void {
    $other = Actors::company();
    Actors::grant($this->user, $other, ['fixtures.view']);
    SyncKit::note($this->company, ['title' => 'Own company']);
    // B's row commits before A's cursor is issued: a continuation in B would skip it.
    SyncKit::note(Company::query()->findOrFail($other), ['title' => 'Other company']);
    SyncKit::waitVisible();
    $cursorA = companyCursorPull($this, null, $this->headers)['next_cursor'];
    expect($cursorA['session'])->toBeNull();

    $page = companyCursorPull($this, $cursorA, [...$this->headers, 'X-Company-Id' => $other]);

    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'] ?? null)->toBe('cursor_expired')
        ->and(array_column($page['rows'], 'title'))->toBe(['Other company']);
});

it('still continues the cursor of a company in that same company', function (): void {
    SyncKit::note($this->company, ['title' => 'First']);
    SyncKit::waitVisible();
    $cursor = companyCursorPull($this, null, $this->headers)['next_cursor'];
    SyncKit::note($this->company, ['title' => 'Second']);
    SyncKit::waitVisible();

    $page = companyCursorPull($this, $cursor, $this->headers);

    expect($page['reset'])->toBeFalse()
        ->and(array_column($page['rows'], 'title'))->toBe(['Second']);
});
