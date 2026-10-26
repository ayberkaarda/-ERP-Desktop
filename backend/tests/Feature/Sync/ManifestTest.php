<?php

declare(strict_types=1);

use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Identity\Services\UserAdministration;
use App\Modules\Organization\Models\Company;
use App\Modules\Sync\Services\Visibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\FixtureNote;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Sync;

uses(SyncDatabase::class);

beforeEach(function (): void {
    SyncKit::boot();
});

it('serves the manifest filtered by the user permissions', function (): void {
    [$company, $user] = SyncKit::actor(['fixtures.view', 'fixtures.create']);
    $headers = SyncKit::headers($user, $company);

    $data = SyncKit::wire(SyncKit::manifestOf($this, $headers)->assertOk(), 'sync/manifest.response.schema.json')['data'];

    expect($data['company_id'])->toBe($company->id)
        ->and($data['user_id'])->toBe($user->id)
        ->and($data['device_id'])->toBeString()
        ->and($data['offline_manifest_version'])->toBe(7)
        ->and($data['permissions'])->toBe(['fixtures.create', 'fixtures.view'])
        ->and(array_column($data['resources'], 'resource'))->toBe(['fixture-notes', 'fixture-dated-notes', 'fixture-rates', 'fixture-tags', 'fixture-balances'])
        ->and($data['resources'][0])->toMatchArray(['scope' => 'company', 'read' => 'local-first', 'source' => 'pull', 'window_days' => null, 'writable' => ['create'], 'visibility_generation' => 0])
        ->and($data['resources'][1])->toMatchArray(['window_days' => 30, 'writable' => []])
        ->and($data['online_only'])->toBe(['closeFixtureNote', 'serverCalculation'])
        ->and($data['limits'])->toBe([
            'pull_resources_max' => 32, 'pull_page_default' => 200, 'pull_page_max' => 1000,
            'push_batch_max' => 200, 'tombstone_retention_days' => 90, 'idempotency_retention_days' => 7,
        ]);
});

it('lists every write op the user holds and nothing for a resource without its permission', function (): void {
    [$company, $user] = SyncKit::actor(['fixtures.dated']);
    $data = SyncKit::wire(SyncKit::manifestOf($this, SyncKit::headers($user, $company))->assertOk(), 'sync/manifest.response.schema.json')['data'];

    expect(array_column($data['resources'], 'resource'))->toBe(['fixture-dated-notes'])
        ->and($data['online_only'])->toBe(['serverCalculation']);

    [$company, $admin] = SyncKit::actor();
    $data = SyncKit::wire(SyncKit::manifestOf($this, SyncKit::headers($admin, $company))->assertOk(), 'sync/manifest.response.schema.json')['data'];

    expect($data['resources'][0]['writable'])->toBe(['create', 'update', 'delete', 'action:close']);
});

it('raises the visibility generation when a resource is hidden and shown again', function (): void {
    [$company, $user] = SyncKit::actor(['fixtures.view']);
    $headers = SyncKit::headers($user, $company);
    $generation = fn (): ?int => collect(SyncKit::wire(SyncKit::manifestOf($this, $headers)->assertOk(), 'sync/manifest.response.schema.json')['data']['resources'])
        ->firstWhere('resource', 'fixture-notes')['visibility_generation'] ?? null;

    expect($generation())->toBe(0)->and($generation())->toBe(0);

    Actors::revoke($user, $company->id);
    expect($generation())->toBeNull();

    Actors::grant($user, $company->id, ['fixtures.view']);
    expect($generation())->toBe(2);
});

it('refuses tokens without the desktop ability and browser sessions', function (): void {
    [$company, $user] = SyncKit::actor();

    SyncKit::wire(SyncKit::manifestOf($this, Sync::webTokenHeaders($user, $company))->assertForbidden(), 'sync/error.response.schema.json');
    SyncKit::wire(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => null]], Sync::webTokenHeaders($user, $company))->assertForbidden(), 'sync/error.response.schema.json');
    $push = SyncKit::push($this, [SyncKit::mutation('create', (string) Str::uuid7(), ['title' => 'x'])], Sync::webTokenHeaders($user, $company))->assertForbidden();

    expect(SyncKit::wire($push, 'sync/error.response.schema.json')['errors']['code'])->toBe('FORBIDDEN');
    Identity::fresh();
    $this->flushHeaders()->getJson('/api/v1/sync/manifest')->assertUnauthorized();
});

it('needs the company header and a membership', function (): void {
    [$company, $user] = SyncKit::actor();
    $headers = SyncKit::headers($user, $company);
    unset($headers['X-Company-Id']);

    expect(SyncKit::wire(SyncKit::manifestOf($this, $headers)->assertStatus(400), 'sync/error.response.schema.json')['errors']['code'])->toBe('COMPANY_REQUIRED');

    [$other] = SyncKit::actor();
    $headers['X-Company-Id'] = $other->id;
    expect(SyncKit::wire(SyncKit::manifestOf($this, $headers)->assertForbidden(), 'sync/error.response.schema.json')['errors']['code'])->toBe('COMPANY_FORBIDDEN');
});

it('resets cursors when membership is revoked and granted again between two syncs', function (): void {
    [$company, $user] = SyncKit::actor(['fixtures.view']);
    $headers = SyncKit::headers($user, $company);
    $cursor = SyncKit::wire(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => null]], $headers)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'][0]['next_cursor'];

    // No manifest or pull in between: only the membership event can tell.
    app(UserAdministration::class)->syncRoles(null, $user, $company->id, []);
    Actors::grant($user, $company->id, ['fixtures.view']);

    $page = SyncKit::wire(SyncKit::pull($this, [['resource' => 'fixture-notes', 'cursor' => $cursor]], $headers)->assertOk(), 'sync/pull.response.schema.json')['data']['resources'][0];

    expect($page['reset'])->toBeTrue()
        ->and($page['reset_reason'])->toBe('visibility_changed')
        ->and($page['next_cursor']['gen'])->toBe(1);
});

it('refuses a schema_version that is not a strict supported integer', function (string $endpoint, mixed $version, int $status, string $code): void {
    [$company, $user] = SyncKit::actor();
    $body = $endpoint === 'pull'
        ? ['schema_version' => $version, 'resources' => [['resource' => 'fixture-notes', 'cursor' => null]]]
        : ['schema_version' => $version, 'mutations' => [SyncKit::mutation('create', (string) Str::uuid7(), ['title' => 'x'])]];

    $response = SyncKit::post($this, $endpoint, $body, SyncKit::headers($user, $company))->assertStatus($status);

    expect(SyncKit::wire($response, 'sync/error.response.schema.json')['errors']['code'])->toBe($code)
        ->and(FixtureNote::withoutCompanyScope()->count())->toBe(0);
})->with([
    'pull "99"' => ['pull', '99', 422, 'VALIDATION_ERROR'],
    'pull "1"' => ['pull', '1', 422, 'VALIDATION_ERROR'],
    'pull 1.5' => ['pull', 1.5, 422, 'VALIDATION_ERROR'],
    'pull 99' => ['pull', 99, 409, 'SYNC_SCHEMA_MISMATCH'],
    'push "99"' => ['push', '99', 422, 'VALIDATION_ERROR'],
    'push 99' => ['push', 99, 409, 'SYNC_SCHEMA_MISMATCH'],
]);

it('removes generations, resolutions and download cursors with their user and company', function (): void {
    [$company, $user] = SyncKit::actor(['fixtures.view']);
    SyncKit::manifestOf($this, SyncKit::headers($user, $company))->assertOk();
    $resolution = fn (string $userId, string $companyId): bool => DB::table('sync_push_resolutions')->insert([
        'resolved_scope_hash' => hash('sha256', $userId.$companyId), 'resolved_key' => (string) Str::uuid7(), 'superseded_by' => (string) Str::uuid7(),
        'user_id' => $userId, 'company_id' => $companyId, 'created_at' => now(),
    ]);
    $resolution($user->id, $company->id);
    expect(DB::table('sync_visibility_generations')->where('user_id', $user->id)->count())->toBeGreaterThan(0);

    DB::table('users')->where('id', $user->id)->delete();
    expect(DB::table('sync_visibility_generations')->where('user_id', $user->id)->count())->toBe(0)
        ->and(DB::table('sync_push_resolutions')->where('user_id', $user->id)->count())->toBe(0);

    // A bare company (no seeded fiscal data that would restrict its delete).
    $bare = Company::factory()->create();
    [, $other] = SyncKit::actor();
    $resolution($other->id, $bare->id);
    app(Visibility::class)->observe($other->id, $bare->id, 'fixture-notes', true);
    app(DeviceTokens::class)->issue($other, Request::create('/'), 'FK device', 'fp-fk');
    $device = DB::table('user_devices')->where('user_id', $other->id)->value('id');
    DB::statement("INSERT INTO sync_full_downloads (device_id, user_id, company_id, resource, cursor_hash, started_horizon, created_at, updated_at) VALUES (?, ?, ?, 'fixture-notes', ?, '5'::xid8, now(), now())", [$device, $other->id, $bare->id, str_repeat('d', 64)]);
    DB::table('companies')->where('id', $bare->id)->delete();

    expect(DB::table('sync_push_resolutions')->where('company_id', $bare->id)->count())->toBe(0)
        ->and(DB::table('sync_visibility_generations')->where('company_id', $bare->id)->count())->toBe(0)
        ->and(DB::table('sync_full_downloads')->where('company_id', $bare->id)->count())->toBe(0);
});
