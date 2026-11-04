<?php

declare(strict_types=1);

use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * Black-box pull attacks against the shipped offline manifest and the real module adapters.
 *
 * A malicious or ordinary desktop client only needs read access to a resource to drive the
 * server's own row renderer. The renderer (Rows::render) reloads each adapter's declared embeds
 * by name against the already-loaded Eloquent relations; if an adapter declares an embed under a
 * name that is not the relation method's name, the reload calls a relation that does not exist and
 * the whole pull — every resource batched in the same request — fails with 500 SERVER_ERROR.
 *
 * Each test here asserts the SAFE behaviour (a 200 pull). A failure is the finding: the attack
 * reached a server crash instead of data.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
    $this->w->user = SalesKit::user(['items.view', 'parties.view']);
    $this->fingerprint = 'fp-attack-embed-0001';
});

/**
 * @return array{token: string, refresh_token: string}
 */
function attackLogin(object $test, string $fingerprint): array
{
    Identity::fresh();
    $data = $test->postJson('/api/v1/auth/device', [
        'email' => $test->w->user->email,
        'password' => Identity::PASSWORD,
        'device_name' => 'Kasa PC',
        'fingerprint' => $fingerprint,
    ])->assertOk()->json('data');

    return ['token' => (string) $data['token'], 'refresh_token' => (string) $data['refresh_token']];
}

/** @return array<string, string> */
function attackHeaders(object $test, string $token): array
{
    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $test->w->company];
}

it('ATK-EMBED-01 serves an items pull without crashing on the declared embeds', function (): void {
    $login = attackLogin($this, $this->fingerprint);
    SyncKit::waitVisible();

    $response = SyncKit::pull($this, [['resource' => 'items', 'cursor' => null]], attackHeaders($this, $login['token']));

    // The finding: this real pull returns 500 SERVER_ERROR because ItemSyncResource::embeds()
    // declares 'base_unit' while the relation is baseUnit(); Rows::render then runs
    // $model->load(['base_unit']) and Eloquent throws RelationNotFoundException.
    $response->assertOk();
    $resources = SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'];
    $rows = $resources[0]['rows'];

    expect($rows)->not->toBeEmpty()
        ->and(array_column($rows, 'id'))->toContain($this->w->item->id)
        ->and($rows[0])->toHaveKey('base_unit');
});

it('ATK-EMBED-02 does not let an items crash take down an unrelated resource batched with it', function (): void {
    $login = attackLogin($this, $this->fingerprint);
    SalesKit::in($this->w->company, fn () => null); // ensure a party exists for the parties pull
    SyncKit::waitVisible();

    // A client batches a healthy resource (parties) together with items. If items crashes the
    // request, the client never receives the parties page either.
    $response = SyncKit::pull($this, [
        ['resource' => 'parties', 'cursor' => null],
        ['resource' => 'items', 'cursor' => null],
    ], attackHeaders($this, $login['token']));

    $response->assertOk();
});
