<?php

declare(strict_types=1);

use Tests\Feature\Sync\Support\SyncKit;
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
