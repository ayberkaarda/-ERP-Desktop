<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Identity\Models\Role;
use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Organization\Models\Company;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Identity;

/*
 * Abuse group A / 2: visibility generations (Identity AccessChanged) attacked by a user whose
 * access is taken away and given back between two syncs. The client keeps its old cursor and
 * hopes to continue it without a reset (so rows it should have purged stay, and the stream it
 * resumes is not the one the cursor walked). All access changes go through the real REST
 * endpoints an admin uses; the pulls are real desktop pulls. Safe behaviour asserted; red = finding.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
    [$this->company, $this->user] = SyncKit::actor(['fixtures.view', 'fixtures.create']);
    $this->headers = SyncKit::headers($this->user, $this->company);
    $this->admin = Actors::user([], $this->company->id, ['is_super_admin' => true]);
    $this->role = app(CompanyContext::class)->runAs($this->company->id, fn (): Role => Role::query()
        ->whereIn('id', DB::table('model_has_roles')->where('model_id', $this->user->id)->pluck('role_id'))->firstOrFail());

    SyncKit::note($this->company, ['title' => 'Visible']);
    SyncKit::waitVisible();
    $this->cursor = abuseAVisPull($this, null)['next_cursor'];
});

/**
 * @param  array<string, mixed>|null  $cursor
 * @return array<string, mixed>
 */
function abuseAVisPull(object $test, ?array $cursor, ?array $headers = null): array
{
    $response = SyncKit::pull($test, [['resource' => 'fixture-notes', 'cursor' => $cursor]], $headers ?? $test->headers)->assertOk();

    return SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0];
}

/**
 * An admin request through the web session, as the admin UI sends it.
 *
 * @param  array<string, mixed>  $body
 */
function abuseAAdmin(object $test, string $method, string $uri, array $body, ?string $company = null): void
{
    Identity::fresh();
    $test->actingAs($test->admin, 'web')
        ->withHeaders(['X-Company-Id' => $company ?? $test->company->id, 'Accept' => 'application/json'])
        ->json($method, '/api/v1/'.$uri, $body)
        ->assertSuccessful();
    Identity::fresh();
    app(CompanyAuthorizer::class)->forget();
}

function abuseAGeneration(object $test, ?string $company = null): ?int
{
    $value = DB::table('sync_visibility_generations')
        ->where('user_id', $test->user->id)->where('company_id', $company ?? $test->company->id)->where('resource', 'fixture-notes')
        ->value('generation');

    return $value === null ? null : (int) $value;
}

it('ABA-VIS-01 resets the old cursor when a role loses and regains the permission over REST between two syncs', function (): void {
    abuseAAdmin($this, 'PATCH', "roles/{$this->role->id}", ['permissions' => ['fixtures.create']]);
    $hidden = abuseAGeneration($this);
    abuseAAdmin($this, 'PATCH', "roles/{$this->role->id}", ['permissions' => ['fixtures.view', 'fixtures.create']]);

    $page = abuseAVisPull($this, $this->cursor);

    expect($hidden)->toBe(1)
        ->and($page['reset'])->toBeTrue()
        ->and($page['reset_reason'])->toBe('visibility_changed')
        ->and($page['next_cursor']['gen'])->toBe(2);
});

it('ABA-VIS-02 refuses the device while the membership is off and resets the old cursor when it comes back', function (): void {
    abuseAAdmin($this, 'PUT', "users/{$this->user->id}/roles", ['company_id' => $this->company->id, 'roles' => []]);

    // While out of the company, the still-valid device token reads nothing there.
    $out = SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $this->cursor]], $this->headers);
    expect($out->status())->toBeIn([401, 403]);

    abuseAAdmin($this, 'PUT', "users/{$this->user->id}/roles", ['company_id' => $this->company->id, 'roles' => [$this->role->id]]);

    $page = abuseAVisPull($this, $this->cursor);
    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'])->toBe('visibility_changed');
});

it('ABA-VIS-03 raises the generation when two roles are removed concurrently by two processes and resets after a REST restore', function (): void {
    $second = app(CompanyContext::class)->runAs($this->company->id, function (): Role {
        $role = new Role(['name' => 'Second readers', 'guard_name' => 'web']);
        $role->save();
        $role->givePermissionTo('fixtures.view');
        $this->user->unsetRelation('roles');
        $this->user->assignRole($role);

        return $role;
    });
    app(CompanyAuthorizer::class)->forget();
    $cursor = abuseAVisPull($this, null)['next_cursor'];
    $before = abuseAGeneration($this);

    $config = config('database.connections.'.config('database.default'));
    $env = array_merge(getenv(), [
        'APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_URL' => '', 'CACHE_STORE' => 'array', 'QUEUE_CONNECTION' => 'sync',
        'DB_HOST' => (string) $config['host'], 'DB_PORT' => (string) $config['port'],
        'DB_DATABASE' => (string) $config['database'], 'DB_USERNAME' => (string) $config['username'],
        'DB_PASSWORD' => (string) $config['password'], 'APP_KEY' => (string) config('app.key'), 'BROADCAST_CONNECTION' => 'null',
    ]);
    $marker = (string) tempnam(sys_get_temp_dir(), 'abv');
    unlink($marker);
    $out = $marker.'.out';
    // The child takes fixtures.view away from the second role and keeps its transaction open.
    $process = proc_open(
        [PHP_BINARY, base_path('tests/Feature/Sync/Support/visibility_worker.php'), $this->company->id, $second->id, $this->admin->id, $marker],
        [1 => ['file', $out, 'w'], 2 => ['file', $out.'.err', 'w']], $pipes, base_path(), $env,
    );
    expect(is_resource($process))->toBeTrue();

    for ($i = 0; $i < 300 && ! is_file($marker); $i++) {
        usleep(100_000);
    }
    expect(is_file($marker))->toBeTrue('the child did not change its role: '.(string) @file_get_contents($out.'.err'));

    // Meanwhile the admin empties the first role over REST.
    abuseAAdmin($this, 'PATCH', "roles/{$this->role->id}", ['permissions' => ['fixtures.create']]);

    for ($i = 0; $i < 300 && (proc_get_status($process)['running'] ?? false); $i++) {
        usleep(100_000);
    }
    proc_close($process);
    $child = (string) @file_get_contents($out);
    $error = (string) @file_get_contents($out.'.err');
    @unlink($marker);
    @unlink($out);
    @unlink($out.'.err');
    expect($child)->toContain('"ok"', $error);

    $hidden = abuseAGeneration($this);

    // Access is given back over REST before any sync.
    abuseAAdmin($this, 'PATCH', "roles/{$this->role->id}", ['permissions' => ['fixtures.view', 'fixtures.create']]);
    $page = abuseAVisPull($this, $cursor);

    expect($hidden)->toBe($before + 1)
        ->and($page['reset_reason'] ?? null)->toBe('visibility_changed');
});

it('ABA-VIS-04 resets the old cursor when setMembership switches off and on, and ignores a no-op', function (): void {
    $directory = app(CompanyDirectory::class);

    DB::transaction(fn () => $directory->setMembership($this->user->id, $this->company->id, false));
    app(CompanyAuthorizer::class)->forget();
    $off = SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $this->cursor]], $this->headers);
    DB::transaction(fn () => $directory->setMembership($this->user->id, $this->company->id, true));
    DB::transaction(fn () => $directory->setMembership($this->user->id, $this->company->id, true));
    app(CompanyAuthorizer::class)->forget();

    expect($off->status())->toBeIn([401, 403])
        ->and(abuseAGeneration($this))->toBe(2)
        ->and(abuseAVisPull($this, $this->cursor)['reset_reason'] ?? null)->toBe('visibility_changed');
});

it('ABA-VIS-05 keeps the companies of a two-company user apart: no foreign row, resets only where access changed', function (): void {
    $other = Actors::company();
    Actors::grant($this->user, $other, ['fixtures.view']);
    // Company B's row exists before A's cursor position, A gets another one after it.
    $otherNote = SyncKit::note(Company::query()->findOrFail($other), ['title' => 'Other company']);
    SyncKit::note($this->company, ['title' => 'Visible later']);
    SyncKit::waitVisible();
    $otherHeaders = [...$this->headers, 'X-Company-Id' => $other];

    // A's cursor replayed against B never yields a row of A.
    $mixed = abuseAVisPull($this, $this->cursor, $otherHeaders);
    expect(array_column($mixed['rows'], 'title'))->not->toContain('Visible later')->not->toContain('Visible');

    $cursorB = abuseAVisPull($this, null, $otherHeaders)['next_cursor'];
    abuseAAdmin($this, 'PATCH', "roles/{$this->role->id}", ['permissions' => ['fixtures.create']]);
    abuseAAdmin($this, 'PATCH', "roles/{$this->role->id}", ['permissions' => ['fixtures.view', 'fixtures.create']]);

    // Taking the access away in A resets A only.
    expect(abuseAVisPull($this, $cursorB, $otherHeaders)['reset'])->toBeFalse()
        ->and(abuseAVisPull($this, $this->cursor)['reset_reason'] ?? null)->toBe('visibility_changed')
        ->and($otherNote->company_id)->toBe($other);
});

it('ABA-VIS-06 does not continue an incremental cursor of company A in company B (cursor not bound to its company)', function (): void {
    $other = Actors::company();
    Actors::grant($this->user, $other, ['fixtures.view']);
    // Company B's row is committed before A's cursor is issued.
    SyncKit::note(Company::query()->findOrFail($other), ['title' => 'Other company']);
    SyncKit::waitVisible();
    $cursorA = abuseAVisPull($this, null)['next_cursor'];

    $page = abuseAVisPull($this, $cursorA, [...$this->headers, 'X-Company-Id' => $other]);

    // Safe: a position issued for (user, A, resource) is not a continuation in B; either B resets
    // or the client still gets B's row. Today the cursor carries only txid/after_id/gen (gen 0 in
    // both companies), so B continues it and the row below A's position is never delivered.
    expect($page['reset'] || in_array('Other company', array_column($page['rows'], 'title'), true))
        ->toBeTrue(json_encode(['reset' => $page['reset'], 'rows' => array_column($page['rows'], 'title')]));
});
