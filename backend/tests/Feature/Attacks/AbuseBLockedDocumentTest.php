<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Purchasing\PurchKit;
use Tests\Support\Sales\SalesKit;
use Tests\Support\Sync;

/*
 * B1 — finalized documents (DOCUMENT_LOCKED). Real HTTP: REST with a web session, sync push with
 * a desktop device token, the shipped contracts/offline-manifest.json and the real writers.
 */
uses(RefreshDatabase::class);

/**
 * @param  array<string, string>  $headers
 * @param  list<array<string, mixed>>  $mutations
 * @return list<array<string, mixed>>
 */
function abLockPush(array $headers, array $mutations): array
{
    Identity::fresh();
    test()->flushHeaders();
    /** @var TestResponse $response */
    $response = test()->withHeaders($headers)->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => $mutations]);
    $response->assertOk();

    /** @var list<array<string, mixed>> */
    return $response->json('data.results');
}

/**
 * @param  array<string, mixed>  $payload
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function abLockMutation(string $resource, string $op, string $id, array $payload = [], ?int $base = null, array $overrides = []): array
{
    return [
        'idempotency_key' => (string) Str::uuid7(),
        'op' => $op,
        'resource' => $resource,
        'id' => $id,
        'base_version' => $op === 'create' ? null : $base,
        'changed_fields' => in_array($op, ['update', 'action'], true) ? array_keys($payload) : [],
        'occurred_at' => '2027-06-14T10:00:00+03:00',
        'payload' => $payload === [] ? new stdClass : $payload,
        ...$overrides,
    ];
}

/** @return array<string, mixed> */
function abLockQuotePayload(object $w, string $notes = 'Offline'): array
{
    return ['party_id' => $w->party->id, 'document_date' => '2027-06-10', 'notes' => $notes, 'lines' => [['item_id' => $w->item->id, 'quantity' => '2', 'unit_price' => '120']]];
}

/** @return array<string, mixed> */
function abLockSentQuote(object $w): array
{
    $quote = SalesKit::post($w->user, $w->company, 'sales-quotes', abLockQuotePayload($w, 'Original'))->assertCreated()->json('data');

    return SalesKit::post($w->user, $w->company, "sales-quotes/{$quote['id']}/send")->assertOk()->assertJsonPath('data.status', 'sent')->json('data');
}

/** @return array<string, mixed> */
function abLockRow(string $table, string $id): array
{
    return (array) DB::table($table)->where('id', $id)->first();
}

/** @return array<string, mixed> */
function abLockRequestPayload(object $w, string $notes = 'Offline'): array
{
    return ['needed_by' => '2027-07-01', 'notes' => $notes, 'lines' => [['item_id' => $w->item->id, 'quantity' => '10', 'estimated_price' => '50']]];
}

/**
 * Purchase requests in every status a user can reach on the web: draft, pending_approval,
 * rejected, approved, cancelled. Approval above 100 for the ones that go to approval.
 *
 * @return array<string, array<string, mixed>> status => REST detail
 */
function abLockRequestsByStatus(object $w): array
{
    $get = static fn (string $id): array => PurchKit::get($w->user, $w->company, "purchase-requests/{$id}")->assertOk()->json('data');
    $create = static fn (): string => PurchKit::post($w->user, $w->company, 'purchase-requests', abLockRequestPayload($w, 'Original'))->assertCreated()->json('data.id');

    $out = [];
    $out['draft'] = $get($create());

    // Approved: submit without an approval threshold.
    $approved = $create();
    PurchKit::post($w->user, $w->company, "purchase-requests/{$approved}/submit")->assertOk()->assertJsonPath('data.status', 'approved');
    $out['approved'] = $get($approved);

    $cancelled = $create();
    PurchKit::post($w->user, $w->company, "purchase-requests/{$cancelled}/submit")->assertOk();
    $cancelledRow = $get($cancelled);
    PurchKit::post($w->user, $w->company, "purchase-requests/{$cancelled}/cancel", ['version' => $cancelledRow['version']])->assertOk()->assertJsonPath('data.status', 'cancelled');
    $out['cancelled'] = $get($cancelled);

    PurchKit::setting($w->company, 'purchasing.request_approval_over', '100');
    $approver = Actors::user(['approvals.view', 'approvals.decide', 'approval_flows.manage'], $w->company);
    PurchKit::post($approver, $w->company, 'approval-flows', [
        'name' => 'Purchase requests', 'document_type' => 'purchase_request',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => $approver->id]],
    ])->assertCreated();

    $pending = $create();
    PurchKit::post($w->user, $w->company, "purchase-requests/{$pending}/submit")->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $out['pending_approval'] = $get($pending);

    $rejected = $create();
    $sent = PurchKit::post($w->user, $w->company, "purchase-requests/{$rejected}/submit")->assertOk()->json('data');
    $approval = PurchKit::get($approver, $w->company, "approvals/{$sent['approval_request_id']}")->json('data');
    PurchKit::post($approver, $w->company, "approvals/{$sent['approval_request_id']}/decisions", ['decision' => 'reject', 'comment' => 'No', 'version' => $approval['version'], 'step' => $approval['current_step']])->assertOk();
    $out['rejected'] = $get($rejected);
    expect($out['rejected']['status'])->toBe('rejected');

    return $out;
}

/** @return array<string, string> */
function abLockHeaders(User $user, string $company, string $fingerprint = 'fp-abuse-b-lock-0001'): array
{
    $headers = Sync::deviceHeaders($user, null, $fingerprint);
    $headers['X-Company-Id'] = $company;

    return $headers;
}

it('B1-01 locks a sent quote on REST and on push: update and delete with a fresh, stale or huge base', function (): void {
    $w = SalesKit::world(stock: false);
    $sent = abLockSentQuote($w);
    $before = abLockRow('sales_quotes', $sent['id']);
    $v = (int) $sent['version'];

    SalesKit::patch($w->user, $w->company, "sales-quotes/{$sent['id']}", ['version' => $v, 'notes' => 'web edit'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    SalesKit::as($w->user, $w->company)->deleteJson("/api/v1/sales-quotes/{$sent['id']}?version={$v}")
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    $headers = abLockHeaders($w->user, $w->company);
    $results = abLockPush($headers, [
        abLockMutation('sales-quotes', 'update', $sent['id'], ['notes' => 'push fresh'], $v),
        abLockMutation('sales-quotes', 'update', $sent['id'], ['notes' => 'push stale'], 1),
        abLockMutation('sales-quotes', 'update', $sent['id'], ['notes' => 'push huge'], 2_000_000_000),
        abLockMutation('sales-quotes', 'update', $sent['id'], ['lines' => [['item_id' => $w->item->id, 'quantity' => '99', 'unit_price' => '1']]], $v),
        abLockMutation('sales-quotes', 'delete', $sent['id'], base: $v),
        abLockMutation('sales-quotes', 'delete', $sent['id'], base: 1),
    ]);

    foreach ($results as $i => $result) {
        // Mutations after the first refusal of the same id are SYNC_DEPENDENCY_FAILED; none may apply.
        expect($result['status'])->not->toBe('applied', "mutation {$i}")->not->toBe('duplicate', "mutation {$i}");
    }

    expect($results[0]['status'])->toBe('conflict')
        ->and($results[0]['conflict']['code'])->toBe('DOCUMENT_LOCKED')
        ->and($results[0]['conflict']['server_data']['status'])->toBe('sent');

    // Each alone, in its own batch: every op and base answers the lock itself.
    foreach ([
        abLockMutation('sales-quotes', 'update', $sent['id'], ['notes' => 'push stale'], 1),
        abLockMutation('sales-quotes', 'update', $sent['id'], ['notes' => 'push huge'], 2_000_000_000),
        abLockMutation('sales-quotes', 'delete', $sent['id'], base: $v),
        abLockMutation('sales-quotes', 'delete', $sent['id'], base: 1),
    ] as $mutation) {
        $one = abLockPush($headers, [$mutation])[0];
        expect($one['status'])->toBe('conflict')->and($one['conflict']['code'])->toBe('DOCUMENT_LOCKED');
    }

    $after = abLockRow('sales_quotes', $sent['id']);
    expect($after)->toBe($before)
        ->and(DB::table('sales_quote_lines')->where('document_id', $sent['id'])->pluck('quantity')->map(fn ($q) => (string) $q)->all())
        ->toBe(array_map(fn (array $l): string => (string) $l['quantity'], $sent['lines']));
});

it('B1-02 never lets push change a number or a status, on a draft or on a locked quote', function (): void {
    $w = SalesKit::world(stock: false);
    $headers = abLockHeaders($w->user, $w->company);
    $sent = abLockSentQuote($w);
    $draft = SalesKit::post($w->user, $w->company, 'sales-quotes', abLockQuotePayload($w, 'Draft'))->assertCreated()->json('data');

    // A draft: number is server-assigned, status is a locked field.
    $number = abLockPush($headers, [abLockMutation('sales-quotes', 'update', $draft['id'], ['number' => 'HACK-0001'], (int) $draft['version'])])[0];
    $status = abLockPush($headers, [abLockMutation('sales-quotes', 'update', $draft['id'], ['status' => 'accepted'], (int) $draft['version'])])[0];
    $both = abLockPush($headers, [abLockMutation('sales-quotes', 'update', $draft['id'], ['notes' => 'x', 'status' => 'sent'], (int) $draft['version'])])[0];

    expect($status['status'])->toBe('rejected')->and($status['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and($both['error']['code'] ?? null)->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and(DB::table('sales_quotes')->where('id', $draft['id'])->value('number'))->toBeNull()
        ->and(DB::table('sales_quotes')->where('id', $draft['id'])->value('status'))->toBe('draft');
    // The number is server-assigned: a push naming it is refused outright, never silently dropped.
    expect($number['status'])->toBe('rejected')->and($number['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED');

    // A locked quote: renumbering is refused up front (the field is never offline-writable), whatever the base.
    $renumber = abLockPush($headers, [abLockMutation('sales-quotes', 'update', $sent['id'], ['number' => 'HACK-0002'], (int) $sent['version'])])[0];
    expect($renumber['status'])->toBe('rejected')->and($renumber['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and(DB::table('sales_quotes')->where('id', $sent['id'])->value('number'))->toBe($sent['number']);

    // A create cannot bring its own number or status either.
    $id = (string) Str::uuid7();
    $statusCreate = abLockPush($headers, [abLockMutation('sales-quotes', 'create', $id, [...abLockQuotePayload($w), 'status' => 'accepted'])])[0];
    $numberCreate = abLockPush($headers, [abLockMutation('sales-quotes', 'create', $id, [...abLockQuotePayload($w), 'number' => $sent['number']])])[0];

    expect($statusCreate['error']['code'] ?? null)->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED');
    expect($numberCreate['status'])->toBe('rejected')->and($numberCreate['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED');
    expect(DB::table('sales_quotes')->where('number', $sent['number'])->count())->toBe(1);
});

it('B1-03 cannot revive or alter a locked quote through a create on its id, a resolution or a save-as-new-draft body', function (): void {
    $w = SalesKit::world(stock: false);
    $headers = abLockHeaders($w->user, $w->company);
    $sent = abLockSentQuote($w);
    $before = abLockRow('sales_quotes', $sent['id']);
    $lineIds = DB::table('sales_quote_lines')->where('document_id', $sent['id'])->orderBy('id')->pluck('id')->all();

    $create = abLockPush($headers, [abLockMutation('sales-quotes', 'create', $sent['id'], abLockQuotePayload($w, 'over'))])[0];
    expect($create['status'])->toBe('rejected')->and($create['error']['code'])->toBe('VALIDATION_ERROR')->and($create['error']['fields'])->toHaveKey('id');

    $edit = abLockMutation('sales-quotes', 'update', $sent['id'], ['notes' => 'mine'], (int) $sent['version']);
    $locked = abLockPush($headers, [$edit])[0];
    expect($locked['conflict']['code'])->toBe('DOCUMENT_LOCKED')->and($locked['conflict']['choices'])->toBe(['save_as_new_draft', 'discard']);

    // keep_mine / merge against a DOCUMENT_LOCKED conflict: no such resolution exists.
    foreach (['keep_mine', 'merge'] as $choice) {
        foreach (['DOCUMENT_LOCKED', 'VERSION_CONFLICT'] as $code) {
            $res = abLockPush($headers, [abLockMutation('sales-quotes', 'update', $sent['id'], ['notes' => 'forced'], (int) $sent['version'], [
                'resolution' => ['resolves' => $edit['idempotency_key'], 'code' => $code, 'choice' => $choice],
            ])])[0];
            expect($res['status'])->not->toBe('applied', "{$choice}/{$code}");
        }
    }

    // save_as_new_draft as a client builds it: the server image (number, status, line ids) as a create.
    $image = $locked['conflict']['server_data'];
    $copyId = (string) Str::uuid7();
    $copyPayload = [
        'party_id' => $image['party_id'], 'document_date' => $image['document_date'], 'notes' => 'copy',
        'lines' => array_map(static fn (array $l): array => ['id' => $l['id'], 'item_id' => $l['item_id'], 'quantity' => (string) $l['quantity'], 'unit_price' => (string) $l['unit_price']], $image['lines']),
    ];
    $copy = abLockPush($headers, [abLockMutation('sales-quotes', 'create', $copyId, $copyPayload)])[0];

    expect($copy['status'])->toBe('applied')
        ->and($copy['data']['status'])->toBe('draft')->and($copy['data']['number'])->toBeNull()
        ->and(array_intersect(array_column($copy['data']['lines'], 'id'), $lineIds))->toBe([]);

    expect(abLockRow('sales_quotes', $sent['id']))->toBe($before)
        ->and(DB::table('sales_quote_lines')->where('document_id', $sent['id'])->orderBy('id')->pluck('id')->all())->toBe($lineIds);
});

it('B1-04 locks a confirmed sales order on push and on REST', function (): void {
    $w = SalesKit::world(stock: false);
    $headers = abLockHeaders($w->user, $w->company);
    $order = SalesKit::confirmedOrder($w, [[$w->item->id, '1', '120']]);
    $before = abLockRow('sales_orders', $order['id']);

    $update = abLockPush($headers, [abLockMutation('sales-orders', 'update', $order['id'], ['notes' => 'x'], (int) $order['version'])])[0];
    $delete = abLockPush($headers, [abLockMutation('sales-orders', 'delete', $order['id'], base: (int) $order['version'])])[0];
    $create = abLockPush($headers, [abLockMutation('sales-orders', 'create', $order['id'], ['party_id' => $w->party->id, 'document_date' => '2027-06-10', 'lines' => [['item_id' => $w->item->id, 'quantity' => '1', 'unit_price' => '1']]])])[0];

    expect($update['conflict']['code'] ?? null)->toBe('DOCUMENT_LOCKED')
        ->and($delete['conflict']['code'] ?? null)->toBe('DOCUMENT_LOCKED')
        ->and($create['error']['code'] ?? null)->toBe('VALIDATION_ERROR')
        ->and(abLockRow('sales_orders', $order['id']))->toBe($before);
    SalesKit::patch($w->user, $w->company, "sales-orders/{$order['id']}", ['version' => $order['version'], 'notes' => 'x'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
});

it('B1-05 makes exactly draft and rejected purchase requests editable offline, as manifest draft_only.also says', function (): void {
    $w = PurchKit::world();
    $byStatus = abLockRequestsByStatus($w);
    $headers = abLockHeaders($w->user, $w->company);

    $manifest = json_decode((string) file_get_contents(base_path('../contracts/offline-manifest.json')), true, flags: JSON_THROW_ON_ERROR);
    $draftOnly = collect($manifest['resources'])->firstWhere('resource', 'purchase-requests')['write']['draft_only'];
    $editable = [$draftOnly['value'], ...($draftOnly['also'] ?? [])];
    expect($editable)->toBe(['draft', 'rejected']);

    foreach ($byStatus as $status => $row) {
        $before = abLockRow('purchase_requests', $row['id']);
        $update = abLockPush($headers, [abLockMutation('purchase-requests', 'update', $row['id'], ['notes' => "offline {$status}"], (int) $row['version'])])[0];

        if (in_array($status, $editable, true)) {
            expect($update['status'])->toBe('applied', $status)
                ->and($update['data']['status'])->toBe('draft', $status)
                ->and($update['data']['notes'])->toBe("offline {$status}");
        } else {
            expect($update['status'])->toBe('conflict', $status)
                ->and($update['conflict']['code'])->toBe('DOCUMENT_LOCKED', $status)
                ->and(abLockRow('purchase_requests', $row['id']))->toBe($before);

            $delete = abLockPush($headers, [abLockMutation('purchase-requests', 'delete', $row['id'], base: (int) $row['version'])])[0];
            expect($delete['status'])->toBe('conflict', $status)
                ->and($delete['conflict']['code'])->toBe('DOCUMENT_LOCKED', $status)
                ->and(DB::table('purchase_requests')->where('id', $row['id'])->exists())->toBeTrue();
            PurchKit::patch($w->user, $w->company, "purchase-requests/{$row['id']}", ['version' => $row['version'], 'notes' => 'web'])
                ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
        }
    }
});

it('B1-06 cannot push a rejected request past draft: no status, no approval fields, no submit action', function (): void {
    $w = PurchKit::world();
    $rejected = abLockRequestsByStatus($w)['rejected'];
    $headers = abLockHeaders($w->user, $w->company);
    $before = abLockRow('purchase_requests', $rejected['id']);
    $v = (int) $rejected['version'];

    $status = abLockPush($headers, [abLockMutation('purchase-requests', 'update', $rejected['id'], ['status' => 'approved'], $v)])[0];
    $submit = abLockPush($headers, [abLockMutation('purchase-requests', 'action', $rejected['id'], ['notes' => 'go'], $v, ['action' => 'submit'])])[0];

    expect($status['error']['code'] ?? null)->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and($submit['error']['code'] ?? null)->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and(abLockRow('purchase_requests', $rejected['id']))->toBe($before);

    // Fields that would move it along the approval path are not writable either.
    $approval = abLockPush($headers, [abLockMutation('purchase-requests', 'update', $rejected['id'], ['approval_request_id' => null, 'notes' => 'reopen'], $v)])[0];
    $after = abLockRow('purchase_requests', $rejected['id']);

    // Observed: approval_request_id is dropped; the edit reopens the request as a draft, like the web.
    expect($approval['status'])->toBe('applied')->and($approval['data']['status'])->toBe('draft')->and($after['status'])->toBe('draft');
});

it('B1-07 refuses a delete of a locked quote replayed under the key of an applied draft delete', function (): void {
    $w = SalesKit::world(stock: false);
    $headers = abLockHeaders($w->user, $w->company);
    $draft = SalesKit::post($w->user, $w->company, 'sales-quotes', abLockQuotePayload($w, 'Draft'))->assertCreated()->json('data');
    $sent = abLockSentQuote($w);

    $delete = abLockMutation('sales-quotes', 'delete', $draft['id'], base: (int) $draft['version']);
    expect(abLockPush($headers, [$delete])[0]['status'])->toBe('applied');

    // Same key, other target: IDEMPOTENCY_KEY_REUSED, never a replayed "applied" for the locked quote.
    $reuse = abLockPush($headers, [[...$delete, 'id' => $sent['id'], 'base_version' => (int) $sent['version']]])[0];
    expect($reuse['status'])->toBe('rejected')->and($reuse['error']['code'])->toBe('IDEMPOTENCY_KEY_REUSED')
        ->and(DB::table('sales_quotes')->where('id', $sent['id'])->exists())->toBeTrue();
});
