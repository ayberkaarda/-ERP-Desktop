<?php

declare(strict_types=1);

use App\Core\Http\ErrorCode;
use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\OutcomeStatus;
use App\Core\Sync\WriteOutcome;
use App\Models\User;
use App\Modules\Inventory\Http\Resources\StockDocumentResource;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Sync\StockDocumentSyncResource;
use App\Modules\Inventory\Sync\StockDocumentSyncWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Inventory\Inv;

uses(RefreshDatabase::class);

/**
 * @param  array<string, mixed>  $payload
 */
function invMutation(string $op, ?string $id = null, array $payload = [], ?string $action = null, ?int $base = null): Mutation
{
    return Mutation::fromArray(array_filter([
        'idempotency_key' => (string) Str::uuid7(),
        'op' => $op,
        'resource' => 'stock-documents',
        'id' => $id ?? (string) Str::uuid7(),
        'base_version' => $base,
        'changed_fields' => array_keys($payload),
        'occurred_at' => '2027-06-15T10:00:00Z',
        'payload' => $payload,
        'action' => $action,
    ], static fn (mixed $v): bool => $v !== null));
}

function invRun(User $user, string $company, Closure $fn): mixed
{
    Inv::as($user, $company);

    return Inv::in($company, $fn);
}

beforeEach(function (): void {
    Inv::boot();
    $this->company = Inv::company();
    $this->wh = Inv::warehouse($this->company, 'MAIN', default: true);
    $this->item = Inv::item($this->company, ['code' => 'W1'])->id;
    Inv::receive($this->company, $this->wh->id, $this->item, '10', '2');
    $this->user = Actors::user(Inv::ALL);
    $this->count = fn (array $extra = []): array => ['doc_type' => 'count', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id, ...$extra];
    $this->create = function (?User $user = null, array $extra = []): WriteOutcome {
        $m = invMutation('create', payload: ($this->count)($extra));

        return invRun($user ?? $this->user, $this->company, fn () => invWriter()->create($user ?? $this->user, $m));
    };
});

it('creates a count draft under the client id with its snapshot lines', function (): void {
    $id = (string) Str::uuid7();
    $m = invMutation('create', $id, ($this->count)());
    $out = invRun($this->user, $this->company, fn () => invWriter()->create($this->user, $m));

    expect($out->status)->toBe(OutcomeStatus::Applied)
        ->and($out->version)->toBe(1)
        ->and($out->data['id'])->toBe($id)
        ->and($out->data['number'])->toBeNull()
        ->and($out->data['status'])->toBe('draft')
        ->and($out->data['lines'])->toHaveCount(1)
        ->and($out->data['lines'][0]['system_quantity'])->toBe('10.000000')
        ->and(DB::table('stock_documents')->where('id', $id)->exists())->toBeTrue();
});

it('keeps sync_txid out of REST and sync responses', function (): void {
    $out = ($this->create)();
    $id = $out->data['id'];
    $rest = Inv::as($this->user, $this->company)->getJson("/api/v1/stock-documents/{$id}")->assertOk()->json('data');
    $list = Inv::as($this->user, $this->company)->getJson('/api/v1/stock-documents')->assertOk()->json('data.0');

    foreach ([$out->data, $rest, $list] as $body) {
        expect(array_key_exists('sync_txid', $body))->toBeFalse();

        foreach ($body['lines'] ?? [] as $line) {
            expect(array_key_exists('sync_txid', $line))->toBeFalse();
        }
    }

    $doc = StockDocument::query()->with('lines')->findOrFail($id);
    $pulled = (new StockDocumentResource($doc))->resolve(request());
    expect(array_key_exists('sync_txid', $pulled))->toBeFalse();
});

it('rejects offline creation of anything but a count', function (): void {
    $m = invMutation('create', payload: ['doc_type' => 'receipt', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $this->item, 'quantity' => '1']]]);
    $out = invRun($this->user, $this->company, fn () => invWriter()->create($this->user, $m));

    expect($out->status)->toBe(OutcomeStatus::Rejected)->and($out->errorCode)->toBe(ErrorCode::SyncOfflineWriteNotAllowed);
});

it('replays the form request: field errors, duplicate id and permission', function (): void {
    $bad = ($this->create)(null, ['warehouse_id' => 'nope']);
    expect($bad->errorCode)->toBe(ErrorCode::ValidationError)->and($bad->errorFields)->toHaveKey('warehouse_id');

    $first = ($this->create)();
    $m = invMutation('create', $first->data['id'], ($this->count)());
    $dup = invRun($this->user, $this->company, fn () => invWriter()->create($this->user, $m));
    expect($dup->errorCode)->toBe(ErrorCode::ValidationError)->and($dup->errorFields)->toHaveKey('id');

    $viewer = Actors::user(['inventory.documents.view']);
    expect(($this->create)($viewer)->errorCode)->toBe(ErrorCode::Forbidden);
});

it('accepts a client uuid on the REST create only when it is a free uuid v7', function (): void {
    $id = (string) Str::uuid7();
    $body = ['id' => $id, ...($this->count)()];
    Inv::postJson($this->user, $this->company, 'stock-documents', $body)->assertCreated()->assertJsonPath('data.id', $id);
    Inv::postJson($this->user, $this->company, 'stock-documents', $body)->assertStatus(422)->assertJsonPath('errors.fields.id.0', fn ($m) => is_string($m));
    Inv::postJson($this->user, $this->company, 'stock-documents', ['id' => (string) Str::uuid(), ...($this->count)()])->assertStatus(422);

    // An update may echo the id.
    $doc = DB::table('stock_documents')->where('id', $id)->first();
    Inv::as($this->user, $this->company)->patchJson("/api/v1/stock-documents/{$id}", ['id' => $id, 'version' => $doc->version, 'notes' => 'x'])->assertOk();
});

it('updates a count draft, rejects stale versions and lines, and logs the version', function (): void {
    $id = ($this->create)()->data['id'];
    $target = invDoc($this->company, $id);

    $m = invMutation('update', $id, ['notes' => 'shelf A'], base: 1);
    $out = invRun($this->user, $this->company, fn () => invWriter()->update($this->user, $m, $target, 1));
    expect($out->status)->toBe(OutcomeStatus::Applied)->and($out->version)->toBe(2)->and($out->data['notes'])->toBe('shelf A');

    $changed = DB::table('activity_log')->where('subject_id', $id)->get()->map(fn ($a) => json_decode($a->attribute_changes, true)['attributes'] ?? [])->all();
    expect(collect($changed)->contains(fn ($a) => array_key_exists('version', $a)))->toBeTrue();

    $fresh = invDoc($this->company, $id);
    $stale = invRun($this->user, $this->company, fn () => invWriter()->update($this->user, $m, $fresh, 1));
    expect($stale->errorCode)->toBe(ErrorCode::VersionConflict);

    $lines = invMutation('update', $id, ['lines' => [['item_id' => $this->item, 'quantity' => '1']]], base: 2);
    $withLines = invRun($this->user, $this->company, fn () => invWriter()->update($this->user, $lines, $fresh, 2));
    expect($withLines->errorCode)->toBe(ErrorCode::ValidationError)->and($withLines->errorFields)->toHaveKey('lines');

    $type = invMutation('update', $id, ['doc_type' => 'receipt'], base: 2);
    expect(invRun($this->user, $this->company, fn () => invWriter()->update($this->user, $type, $fresh, 2))->errorCode)->toBe(ErrorCode::SyncOfflineWriteNotAllowed);
});

it('records counted quantities through the counts action', function (): void {
    $created = ($this->create)()->data;
    $lineId = $created['lines'][0]['id'];
    $target = invDoc($this->company, $created['id']);

    $m = invMutation('action', $created['id'], ['counts' => [['line_id' => $lineId, 'counted_quantity' => '8']]], 'counts', 1);
    $out = invRun($this->user, $this->company, fn () => invWriter()->action($this->user, $m, $target, 1));
    expect($out->status)->toBe(OutcomeStatus::Applied)->and($out->version)->toBe(2)
        ->and($out->data['lines'][0]['counted_quantity'])->toBe('8.000000');

    $foreign = invMutation('action', $created['id'], ['counts' => [['line_id' => (string) Str::uuid7(), 'counted_quantity' => '1']]], 'counts', 2);
    $fresh = invDoc($this->company, $created['id']);
    expect(invRun($this->user, $this->company, fn () => invWriter()->action($this->user, $foreign, $fresh, 2))->errorCode)->toBe(ErrorCode::ValidationError);

    $other = invMutation('action', $created['id'], [], 'post', 2);
    expect(invRun($this->user, $this->company, fn () => invWriter()->action($this->user, $other, $fresh, 2))->errorCode)->toBe(ErrorCode::SyncOfflineWriteNotAllowed);
});

it('locks the document type on the stored record for update, delete and counts', function (): void {
    $receipt = Inv::postJson($this->user, $this->company, 'stock-documents', [
        'doc_type' => 'receipt', 'document_date' => '2027-06-11', 'warehouse_id' => $this->wh->id, 'lines' => [['item_id' => $this->item, 'quantity' => '1', 'unit_cost' => '1']],
    ])->assertCreated()->json('data');
    $target = invDoc($this->company, $receipt['id']);

    expect(invWriter()->targetSatisfies($target, ['doc_type' => ['count']]))->toBeFalse()
        ->and(invWriter()->targetSatisfies($target, ['doc_type' => 'receipt']))->toBeTrue()
        ->and(invWriter()->targetSatisfies($target, ['doc_type' => ['count', 'receipt']]))->toBeTrue();

    $u = invMutation('update', $receipt['id'], ['notes' => 'x'], base: 1);
    $d = invMutation('delete', $receipt['id'], base: 1);
    $a = invMutation('action', $receipt['id'], ['counts' => []], 'counts', 1);

    foreach ([
        fn () => invWriter()->update($this->user, $u, $target, 1),
        fn () => invWriter()->delete($this->user, $d, $target, 1),
        fn () => invWriter()->action($this->user, $a, $target, 1),
    ] as $call) {
        expect(invRun($this->user, $this->company, $call)->errorCode)->toBe(ErrorCode::SyncOfflineWriteNotAllowed);
    }

    expect(DB::table('stock_documents')->where('id', $receipt['id'])->exists())->toBeTrue();
});

it('deletes a count draft with its lines', function (): void {
    $created = ($this->create)()->data;
    $target = invDoc($this->company, $created['id']);
    $m = invMutation('delete', $created['id'], base: 1);
    $out = invRun($this->user, $this->company, fn () => invWriter()->delete($this->user, $m, $target, 1));

    expect($out->status)->toBe(OutcomeStatus::Applied)->and($out->data)->toBeNull()
        ->and(DB::table('stock_documents')->where('id', $created['id'])->exists())->toBeFalse()
        ->and(DB::table('stock_document_lines')->where('document_id', $created['id'])->exists())->toBeFalse();
});

it('reports DOCUMENT_LOCKED once the count is posted', function (): void {
    $created = ($this->create)()->data;
    Inv::postJson($this->user, $this->company, "stock-documents/{$created['id']}/post")->assertOk();
    $target = invDoc($this->company, $created['id']);

    expect(invWriter()->isDraft($target))->toBeFalse()->and(invWriter()->currentVersion($target))->toBeGreaterThan(1);

    $u = invMutation('update', $created['id'], ['notes' => 'late'], base: $target->version);
    $out = invRun($this->user, $this->company, fn () => invWriter()->update($this->user, $u, $target, $target->version));
    expect($out->status)->toBe(OutcomeStatus::Conflict)->and($out->conflict->code)->toBe(ErrorCode::DocumentLocked)
        ->and($out->conflict->serverData['status'])->toBe('posted');

    $d = invMutation('delete', $created['id'], base: $target->version);
    $del = invRun($this->user, $this->company, fn () => invWriter()->delete($this->user, $d, $target, $target->version));
    expect($del->conflict->code)->toBe(ErrorCode::DocumentLocked);
    expect(DB::table('stock_documents')->where('id', $created['id'])->exists())->toBeTrue();
});

it('answers 409 DOCUMENT_LOCKED on REST post, import and stale edits of a posted document', function (): void {
    $doc = ($this->create)()->data;
    $stale = $doc['version'];
    Inv::postJson($this->user, $this->company, "stock-documents/{$doc['id']}/post")->assertOk();
    $api = fn () => Inv::as($this->user, $this->company);
    $file = UploadedFile::fake()->createWithContent('count.csv', "item_code,counted_quantity\nW1,2\n");

    Inv::postJson($this->user, $this->company, "stock-documents/{$doc['id']}/post", ['version' => $stale])->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    $api()->post("/api/v1/stock-documents/{$doc['id']}/import", ['file' => $file, 'version' => $stale], ['Idempotency-Key' => (string) Str::uuid7()])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    $api()->patchJson("/api/v1/stock-documents/{$doc['id']}", ['version' => $stale, 'notes' => 'late'])->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    $api()->patchJson("/api/v1/stock-documents/{$doc['id']}/counts", ['version' => $stale, 'counts' => []])->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    $api()->deleteJson("/api/v1/stock-documents/{$doc['id']}?version={$stale}")->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    expect(DB::table('stock_documents')->where('id', $doc['id'])->value('status'))->toBe('posted');
});

it('answers conflict with the posted server data to stale offline edits of a posted count', function (): void {
    $created = ($this->create)()->data;
    $stale = invDoc($this->company, $created['id']);
    Inv::postJson($this->user, $this->company, "stock-documents/{$created['id']}/post")->assertOk();
    $current = invDoc($this->company, $created['id'])->version;
    expect($current)->toBeGreaterThan($stale->version);

    $lineId = $created['lines'][0]['id'];
    $calls = [
        fn () => invWriter()->update($this->user, invMutation('update', $created['id'], ['notes' => 'late'], base: 1), $stale, 1),
        fn () => invWriter()->delete($this->user, invMutation('delete', $created['id'], base: 1), $stale, 1),
        fn () => invWriter()->action($this->user, invMutation('action', $created['id'], ['counts' => [['line_id' => $lineId, 'counted_quantity' => '1']]], 'counts', 1), $stale, 1),
    ];

    foreach ($calls as $call) {
        $out = invRun($this->user, $this->company, $call);
        expect($out->status)->toBe(OutcomeStatus::Conflict)
            ->and($out->conflict->code)->toBe(ErrorCode::DocumentLocked)
            ->and($out->conflict->serverData['status'])->toBe('posted')
            ->and($out->conflict->serverData['version'])->toBe($current)
            ->and($out->conflict->serverData['id'])->toBe($created['id']);
    }
});

it('turns a create race on the same client id into a validation error on id', function (): void {
    $id = (string) Str::uuid7();
    $armed = true;

    // The rival create lands after the request's unique check, before this insert.
    StockDocument::creating(function (StockDocument $doc) use (&$armed): void {
        if (! $armed) {
            return;
        }

        $armed = false;
        $rival = $doc->replicate();
        $rival->id = $doc->id;
        StockDocument::withoutEvents(fn () => $rival->save());
    });

    $out = invRun($this->user, $this->company, fn () => invWriter()->create($this->user, invMutation('create', $id, ($this->count)())));
    expect($out->status)->toBe(OutcomeStatus::Rejected)
        ->and($out->errorCode)->toBe(ErrorCode::ValidationError)
        ->and($out->errorFields)->toHaveKey('id')
        ->and(DB::table('stock_documents')->where('id', $id)->exists())->toBeFalse();

    $armed = true;
    $rest = (string) Str::uuid7();
    Inv::postJson($this->user, $this->company, 'stock-documents', ['id' => $rest, ...($this->count)()])
        ->assertStatus(422)->assertJsonPath('errors.code', 'VALIDATION_ERROR')->assertJsonPath('errors.fields.id.0', fn ($m) => is_string($m));
    expect($armed)->toBeFalse()->and(DB::table('stock_documents')->where('id', $rest)->exists())->toBeFalse();
});

it('is tagged for the sync module and scopes the read side to the company', function (): void {
    $writers = array_map(fn ($w) => $w::class, iterator_to_array(app()->tagged(SyncWriter::TAG)));
    $resources = array_map(fn ($r) => $r::class, iterator_to_array(app()->tagged(SyncResource::TAG)));
    expect($writers)->toContain(StockDocumentSyncWriter::class)->and($resources)->toContain(StockDocumentSyncResource::class);

    $id = ($this->create)()->data['id'];
    $resource = app(StockDocumentSyncResource::class);
    $rows = $resource->query($this->company)->get();
    expect($rows->pluck('id')->all())->toContain($id)->and($rows->first()->relationLoaded('lines'))->toBeTrue()
        ->and($resource->query((string) Str::uuid7())->count())->toBe(0)
        ->and($resource->windowField())->toBe('document_date')
        ->and(invWriter()->find((string) Str::uuid7()))->toBeNull()
        ->and(invWriter()->lockedFields())->toContain('status');
});

/** Resolved late: Inv::as() refreshes the app's company-bound singletons. */
function invWriter(): StockDocumentSyncWriter
{
    return app(StockDocumentSyncWriter::class);
}

function invDoc(string $company, string $id): StockDocument
{
    return Inv::in($company, fn (): StockDocument => StockDocument::query()->findOrFail($id));
}
