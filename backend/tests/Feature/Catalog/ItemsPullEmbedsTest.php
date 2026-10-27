<?php

declare(strict_types=1);

use Tests\Feature\Sync\Support\SyncKit;
use Tests\Fixtures\Sync\SyncDatabase;
use Tests\Support\Identity;
use Tests\Support\Sales\SalesKit;

/*
 * Items pull over HTTP with a real device token, the shipped offline manifest and the real
 * Catalog adapter. The manifest names the embed by its JSON key (base_unit) while the Eloquent
 * relation is baseUnit(); the row renderer must load the relation, not crash on the key, and a
 * failing items page must not take down the other resources of the same request.
 */
uses(SyncDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
    $this->w->user = SalesKit::user(['items.view', 'parties.view']);
});

/** @return array<string, string> */
function itemsPullHeaders(object $test): array
{
    Identity::fresh();
    $token = (string) $test->postJson('/api/v1/auth/device', [
        'email' => $test->w->user->email,
        'password' => Identity::PASSWORD,
        'device_name' => 'Kasa PC',
        'fingerprint' => 'fp-items-pull-embeds-0001',
    ])->assertOk()->json('data.token');

    return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token, 'X-Company-Id' => $test->w->company];
}

it('serves an items pull with the base_unit, category and units embeds loaded', function (): void {
    $headers = itemsPullHeaders($this);
    SyncKit::waitVisible();

    $response = SyncKit::pull($this, [['resource' => 'items', 'cursor' => null]], $headers)->assertOk();
    $rows = collect(SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'][0]['rows'])->keyBy('id');
    $item = $rows->get($this->w->item->id);

    expect($item)->not->toBeNull()
        ->and($item)->toHaveKeys(['base_unit', 'category', 'units'])
        ->and($item['base_unit']['id'])->toBe($this->w->item->base_unit_id);
});

it('serves the other resources of a request that also pulls items', function (): void {
    $headers = itemsPullHeaders($this);
    SyncKit::waitVisible();

    $response = SyncKit::pull($this, [
        ['resource' => 'parties', 'cursor' => null],
        ['resource' => 'items', 'cursor' => null],
    ], $headers)->assertOk();
    $resources = SyncKit::wire($response, 'sync/pull.response.schema.json')['data']['resources'];

    expect(array_column($resources, 'resource'))->toBe(['parties', 'items'])
        ->and(array_column($resources[0]['rows'], 'id'))->toContain($this->w->party->id);
});
