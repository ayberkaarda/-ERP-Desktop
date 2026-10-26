<?php

declare(strict_types=1);

use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\OutcomeStatus;
use App\Core\Sync\WriteOutcome;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Sync\PurchaseRequestSyncWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\Actors;
use Tests\Support\Purchasing\PurchKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = PurchKit::world();
    $this->writer = app(PurchaseRequestSyncWriter::class);
});

/**
 * @param  array<string, mixed>  $overrides
 */
function requestMutation(array $overrides = []): Mutation
{
    return Mutation::fromArray(array_merge([
        'idempotency_key' => (string) Str::uuid7(),
        'op' => 'create',
        'resource' => 'purchase-requests',
        'id' => (string) Str::uuid7(),
        'base_version' => null,
        'changed_fields' => [],
        'occurred_at' => now()->toIso8601String(),
        'payload' => [],
    ], $overrides));
}

/**
 * @param  list<array<string, mixed>>|null  $lines
 * @return array<string, mixed>
 */
function requestPayload(object $w, ?array $lines = null): array
{
    return [
        'needed_by' => '2027-07-01', 'notes' => 'Offline',
        'lines' => $lines ?? [['item_id' => $w->item->id, 'quantity' => '10', 'estimated_price' => '50']],
    ];
}

/** A write as the Sync module would run it: inside the company, in a transaction. */
function syncWrite(object $w, Closure $fn): WriteOutcome
{
    return PurchKit::in($w->company, fn (): WriteOutcome => DB::transaction($fn));
}

it('creates a draft under the client id with the server derived fields', function (): void {
    $w = $this->w;
    $m = requestMutation(['payload' => [...requestPayload($w), 'currency_code' => 'USD', 'estimated_total' => '1.0000']]);

    $outcome = syncWrite($w, fn () => $this->writer->create($w->user, $m));

    expect($outcome->status)->toBe(OutcomeStatus::Applied)
        ->and($outcome->version)->toBe(1)
        ->and($outcome->data['id'])->toBe($m->id)
        ->and($outcome->data['number'])->toBeNull()
        ->and($outcome->data['status'])->toBe('draft')
        ->and($outcome->data['estimated_total'])->toBe('500.0000')
        ->and($outcome->data['currency_code'])->toBe('TRY')
        ->and($outcome->data['lines'])->toHaveCount(1);
    expect(PurchKit::in($w->company, fn () => PurchaseRequest::query()->whereKey($m->id)->exists()))->toBeTrue();
});

it('returns the same shape as the REST detail', function (): void {
    $w = $this->w;
    $m = requestMutation(['payload' => requestPayload($w)]);
    $outcome = syncWrite($w, fn () => $this->writer->create($w->user, $m));
    $rest = PurchKit::get($w->user, $w->company, "purchase-requests/{$m->id}")->assertOk()->json('data');

    $shared = array_intersect_key($rest, $outcome->data);
    expect($outcome->data)->toBe($shared)->and(array_keys($outcome->data))->not->toContain('sync_txid');
});

it('accepts a client id on REST create and refuses a bad or taken one', function (): void {
    $w = $this->w;
    $id = (string) Str::uuid7();
    $body = ['id' => $id, ...requestPayload($w)];

    PurchKit::post($w->user, $w->company, 'purchase-requests', $body)->assertCreated()->assertJsonPath('data.id', $id);
    PurchKit::post($w->user, $w->company, 'purchase-requests', $body)->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['id']));
    PurchKit::post($w->user, $w->company, 'purchase-requests', ['id' => (string) Str::uuid(), ...requestPayload($w)])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['id']));
    PurchKit::post($w->user, $w->company, 'purchase-requests', requestPayload($w))->assertCreated();
});

it('runs the REST rules: validation and authorization failures are rejected outcomes', function (): void {
    $w = $this->w;
    $none = syncWrite($w, fn () => $this->writer->create($w->user, requestMutation(['payload' => ['notes' => 'no lines']])));
    $bad = syncWrite($w, fn () => $this->writer->create($w->user, requestMutation(['payload' => requestPayload($w, [['item_id' => $w->item->id, 'quantity' => 'x']])])));

    expect($none->status)->toBe(OutcomeStatus::Rejected)->and($none->errorCode)->toBe(ErrorCode::ValidationError)->and($none->errorFields)->toHaveKey('lines')
        ->and($bad->errorFields)->toHaveKey('lines.0.quantity');

    $viewer = Actors::user(['purchasing.requests.view']);
    $denied = syncWrite($w, fn () => $this->writer->create($viewer, requestMutation(['payload' => requestPayload($w)])));
    expect($denied->status)->toBe(OutcomeStatus::Rejected)->and($denied->errorCode)->toBe(ErrorCode::Forbidden);
});

it('updates a draft with the version the resolver passes and keeps the stored lines without lines', function (): void {
    $w = $this->w;
    $m = requestMutation(['payload' => requestPayload($w)]);
    syncWrite($w, fn () => $this->writer->create($w->user, $m));

    $edit = requestMutation(['op' => 'update', 'id' => $m->id, 'base_version' => 1, 'changed_fields' => ['notes'], 'payload' => ['notes' => 'Edited', 'version' => 99]]);
    $outcome = syncWrite($w, fn () => $this->writer->update($w->user, $edit, $this->writer->find($m->id), 1));

    expect($outcome->status)->toBe(OutcomeStatus::Applied)->and($outcome->version)->toBe(2)
        ->and($outcome->data['notes'])->toBe('Edited')->and($outcome->data['estimated_total'])->toBe('500.0000')->and($outcome->data['lines'])->toHaveCount(1);

    $stale = syncWrite($w, fn () => $this->writer->update($w->user, $edit, $this->writer->find($m->id), 1));
    expect($stale->status)->toBe(OutcomeStatus::Rejected)->and($stale->errorCode)->toBe(ErrorCode::VersionConflict);
});

it('reports an edit of a request that left draft as DOCUMENT_LOCKED, never as a write', function (): void {
    $w = $this->w;
    $m = requestMutation(['payload' => requestPayload($w)]);
    syncWrite($w, fn () => $this->writer->create($w->user, $m));
    PurchKit::post($w->user, $w->company, "purchase-requests/{$m->id}/submit")->assertOk()->assertJsonPath('data.status', 'approved');
    $target = PurchKit::in($w->company, fn () => $this->writer->find($m->id));

    expect($this->writer->isDraft($target))->toBeFalse()
        ->and($this->writer->targetSatisfies($target, ['status' => 'approved']))->toBeTrue()
        ->and($this->writer->targetSatisfies($target, ['status' => 'draft']))->toBeFalse();

    $edit = requestMutation(['op' => 'update', 'id' => $m->id, 'base_version' => $target->version, 'changed_fields' => ['notes'], 'payload' => ['notes' => 'late']]);
    $outcome = syncWrite($w, fn () => $this->writer->update($w->user, $edit, $this->writer->find($m->id), $target->version));
    $delete = requestMutation(['op' => 'delete', 'id' => $m->id, 'base_version' => $target->version]);
    $deleted = syncWrite($w, fn () => $this->writer->delete($w->user, $delete, $this->writer->find($m->id), $target->version));

    expect($outcome->status)->toBe(OutcomeStatus::Conflict)->and($outcome->conflict?->code)->toBe(ErrorCode::DocumentLocked)
        ->and($deleted->status)->toBe(OutcomeStatus::Conflict)->and($deleted->conflict?->code)->toBe(ErrorCode::DocumentLocked);
    expect(PurchKit::get($w->user, $w->company, "purchase-requests/{$m->id}")->json('data.notes'))->toBe('Offline');
});

it('answers 409 DOCUMENT_LOCKED on REST for a request past draft', function (): void {
    $w = $this->w;
    $id = PurchKit::post($w->user, $w->company, 'purchase-requests', requestPayload($w))->assertCreated()->json('data.id');
    $sent = PurchKit::post($w->user, $w->company, "purchase-requests/{$id}/submit")->assertOk()->json('data');

    PurchKit::patch($w->user, $w->company, "purchase-requests/{$id}", ['version' => $sent['version'], 'notes' => 'x'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-requests/{$id}?version={$sent['version']}")
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
});

it('deletes a draft and refuses actions offline', function (): void {
    $w = $this->w;
    $m = requestMutation(['payload' => requestPayload($w)]);
    syncWrite($w, fn () => $this->writer->create($w->user, $m));
    $submit = requestMutation(['op' => 'action', 'action' => 'submit', 'id' => $m->id, 'base_version' => 1]);

    expect(syncWrite($w, fn () => $this->writer->action($w->user, $submit, $this->writer->find($m->id), 1))->errorCode)->toBe(ErrorCode::SyncOfflineWriteNotAllowed);

    $delete = requestMutation(['op' => 'delete', 'id' => $m->id, 'base_version' => 1]);
    $outcome = syncWrite($w, fn () => $this->writer->delete($w->user, $delete, $this->writer->find($m->id), 1));

    expect($outcome->toArray())->toBe(['status' => 'applied', 'data' => null])
        ->and(PurchKit::in($w->company, fn () => $this->writer->find($m->id)))->toBeNull();
});

it('tags one writer and the six read adapters under the core tags', function (): void {
    $writers = array_map(static fn (SyncWriter $x): string => $x->resource(), iterator_to_array(app()->tagged(SyncWriter::TAG)));
    $names = array_map(static fn (SyncResource $x): string => $x->name(), iterator_to_array(app()->tagged(SyncResource::TAG)));

    expect($writers)->toContain('purchase-requests')
        ->and($names)->toEqualCanonicalizing(['purchase-requests', 'purchase-rfqs', 'purchase-orders', 'purchase-receipts', 'purchase-invoices', 'purchase-returns']);
});

/**
 * Manifest `derived_fields` of the resource: derived attribute => the fields it depends on.
 *
 * @return array<string, list<string>>
 */
function manifestDerived(string $resource): array
{
    $manifest = json_decode((string) file_get_contents(dirname(__DIR__, 4).'/contracts/offline-manifest.json'), true, flags: JSON_THROW_ON_ERROR);
    $out = [];

    foreach ($manifest['resources'] as $r) {
        if ($r['resource'] === $resource) {
            foreach ($r['write']['derived_fields'] ?? [] as $rule) {
                foreach ($rule['derives'] as $field) {
                    $out[$field] = $rule['when'];
                }
            }
        }
    }

    return $out;
}

it('declares the fields the service derives on every write in the manifest', function (): void {
    $w = $this->w;
    $declared = manifestDerived('purchase-requests');
    $m = requestMutation(['payload' => requestPayload($w)]);
    $sent = ['needed_by', 'notes', 'lines'];
    $outcome = syncWrite($w, fn () => $this->writer->create($w->user, $m));

    // What the server wrote that the client did not send and is not a plain default.
    $derived = ['estimated_total', 'currency_code'];

    expect($outcome->data)->toHaveKeys($derived)->and(array_intersect($sent, $derived))->toBe([]);
    expect($declared)->toHaveKey('estimated_total')->and($declared['estimated_total'])->toBe(['lines']);

    // contracts/offline-manifest.json is owned by the contracts package: `currency_code` (the
    // company base currency, assigned by RequestService::write on every write) is not declared
    // there yet. When it is, drop this expectation and require it in the list above.
    expect(array_values(array_diff($derived, array_keys($declared))))->toBe(['currency_code']);
})->skip(fn (): bool => ! is_file(dirname(__DIR__, 4).'/contracts/offline-manifest.json'));

it('puts a lines-only edit into the audit trail so a stale edit of the lines conflicts', function (): void {
    $w = $this->w;
    $m = requestMutation(['payload' => requestPayload($w)]);
    syncWrite($w, fn () => $this->writer->create($w->user, $m));
    $entries = static fn (): array => Activity::query()->where('subject_type', 'purchase_request')->where('subject_id', $m->id)->orderBy('id')->get()
        ->map(static fn (Activity $a): array => $a->attribute_changes->toArray())->all();

    expect($this->writer->auditFields())->toContain('lines', 'version')
        ->and($entries()[0]['attributes'])->toHaveKey('lines');

    // Another item at the same total: no header column but the version changes; only `lines` tells.
    $swap = requestMutation(['op' => 'update', 'id' => $m->id, 'base_version' => 1, 'changed_fields' => ['lines'], 'payload' => ['lines' => [['item_id' => $w->service->id, 'quantity' => '10', 'estimated_price' => '50']]]]);
    $result = syncWrite($w, fn () => $this->writer->update($w->user, $swap, $this->writer->find($m->id), 1));
    $log = $entries();

    expect($result->status)->toBe(OutcomeStatus::Applied)->and($result->data['estimated_total'])->toBe('500.0000')
        ->and($log)->toHaveCount(2)
        ->and($log[1]['attributes'])->toHaveKeys(['version', 'lines'])
        ->and($log[1]['old']['lines'])->toBe($log[0]['attributes']['lines'])
        ->and($log[1]['attributes']['lines'])->not->toBe($log[0]['attributes']['lines']);

    // A header-only edit repeats the stored lines and must not claim a change of them.
    $note = requestMutation(['op' => 'update', 'id' => $m->id, 'base_version' => 2, 'changed_fields' => ['notes'], 'payload' => ['notes' => 'again']]);
    syncWrite($w, fn () => $this->writer->update($w->user, $note, $this->writer->find($m->id), 2));
    $log = $entries();

    expect($log)->toHaveCount(3)->and($log[2]['attributes'])->not->toHaveKey('lines');
});

it('keeps sync_txid out of every purchasing resource', function (): void {
    $w = $this->w;
    $request = PurchKit::post($w->user, $w->company, 'purchase-requests', requestPayload($w))->assertCreated()->json('data');
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '5', '10']]);
    $receipt = PurchKit::receive($w, $order['id'], [$order['lines'][0]['id'] => '5']);
    $invoice = PurchKit::invoiceReceipt($w, $receipt['id']);
    PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/submit")->assertOk();
    $rfq = PurchKit::post($w->user, $w->company, "purchase-requests/{$request['id']}/rfq", ['supplier_ids' => [$w->party->id]])->assertCreated()->json('data');

    $uris = ['purchase-requests' => $request['id'], 'purchase-rfqs' => $rfq['id'], 'purchase-orders' => $order['id'], 'purchase-receipts' => $receipt['id'], 'purchase-invoices' => $invoice['id']];

    foreach ($uris as $path => $id) {
        $detail = PurchKit::get($w->user, $w->company, "{$path}/{$id}")->assertOk()->json('data');
        $list = PurchKit::get($w->user, $w->company, $path)->assertOk()->json('data.0');
        expect(array_keys($detail))->not->toContain('sync_txid')->and(array_keys($list))->not->toContain('sync_txid')
            ->and(json_encode($detail))->not->toContain('sync_txid');
        expect(DB::table($path === 'purchase-requests' ? 'purchase_requests' : str_replace('-', '_', $path))->where('id', $id)->value('sync_txid'))->not->toBeNull();
    }
});

it('answers DOCUMENT_LOCKED before any version check, on REST and in the writer', function (): void {
    $w = $this->w;
    $m = requestMutation(['payload' => requestPayload($w)]);
    syncWrite($w, fn () => $this->writer->create($w->user, $m));
    $sent = PurchKit::post($w->user, $w->company, "purchase-requests/{$m->id}/submit")->assertOk()->json('data');

    // REST: a stale version on a locked document is still the lock, not a version conflict.
    PurchKit::patch($w->user, $w->company, "purchase-requests/{$m->id}", ['version' => 99, 'notes' => 'x'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-requests/{$m->id}?version=99")
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    $order = PurchKit::approvedOrder($w, [[$w->item->id, '1', '10']]);
    PurchKit::patch($w->user, $w->company, "purchase-orders/{$order['id']}", ['version' => 99, 'notes' => 'x'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    PurchKit::as($w->user, $w->company)->deleteJson("/api/v1/purchase-orders/{$order['id']}?version=99")
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    // Writer: the conflict carries the lock and the server image, whatever base version came in.
    $edit = requestMutation(['op' => 'update', 'id' => $m->id, 'base_version' => 1, 'changed_fields' => ['notes'], 'payload' => ['notes' => 'late']]);
    $outcome = syncWrite($w, fn () => $this->writer->update($w->user, $edit, $this->writer->find($m->id), 1));
    $delete = requestMutation(['op' => 'delete', 'id' => $m->id, 'base_version' => 1]);
    $deleted = syncWrite($w, fn () => $this->writer->delete($w->user, $delete, $this->writer->find($m->id), 1));

    foreach ([$outcome, $deleted] as $result) {
        expect($result->status)->toBe(OutcomeStatus::Conflict)
            ->and($result->conflict?->code)->toBe(ErrorCode::DocumentLocked)
            ->and($result->conflict?->serverVersion)->toBe($sent['version'])
            ->and($result->conflict?->serverData['id'] ?? null)->toBe($m->id)
            ->and($result->conflict?->serverData['status'] ?? null)->toBe('approved');
    }
});

it('turns a primary key race on a client id into a validation error, not a 500 or an exception', function (): void {
    $w = $this->w;
    $armed = new ArrayObject(['on' => true]);
    // Another create of the same id lands between validation and the INSERT.
    PurchaseRequest::creating(static function (PurchaseRequest $m) use ($armed, $w): void {
        if ($armed['on']) {
            DB::table('purchase_requests')->insert([
                'id' => $m->id, 'company_id' => $w->company, 'status' => 'draft', 'document_date' => '2027-06-15',
                'currency_code' => 'TRY', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    });

    // Writer first: a REST call resets the container's company context for later in-test writes.
    $m = requestMutation(['payload' => requestPayload($w)]);
    $outcome = syncWrite($w, fn () => $this->writer->create($w->user, $m));
    $armed['on'] = false;

    $armed['on'] = true;
    $id = (string) Str::uuid7();
    PurchKit::post($w->user, $w->company, 'purchase-requests', ['id' => $id, ...requestPayload($w)])
        ->assertStatus(422)->assertJsonPath('errors.code', 'VALIDATION_ERROR')->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['id']));

    $armed['on'] = false;

    expect($outcome->status)->toBe(OutcomeStatus::Rejected)->and($outcome->errorCode)->toBe(ErrorCode::ValidationError)
        ->and($outcome->errorFields)->toHaveKey('id');
    expect(DB::table('purchase_requests')->whereIn('id', [$id, $m->id])->count())->toBe(0);
});
