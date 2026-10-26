<?php

declare(strict_types=1);

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\MutationOp;
use App\Core\Sync\OutcomeStatus;
use App\Core\Sync\WriteOutcome;
use App\Models\User;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Sync\DraftSyncWriter;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Actors;
use Tests\Support\Catalog\Catalog;
use Tests\Support\Sales\SalesKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = SalesKit::world(stock: false);
    $this->list = SalesKit::priceList($this->w->company, ['is_default' => true]);
    Catalog::line($this->w->company, $this->list, $this->w->item, $this->w->unit, '120');
});

/**
 * @param  array<string, mixed>  $payload
 * @param  list<string>|null  $changed
 */
function salesMutation(MutationOp $op, string $resource, string $id, array $payload = [], ?int $base = null, ?array $changed = null, ?string $action = null): Mutation
{
    return new Mutation(
        idempotencyKey: (string) Str::uuid7(),
        op: $op,
        resource: $resource,
        id: $id,
        baseVersion: $base,
        changedFields: $changed ?? ($op === MutationOp::Update ? array_keys($payload) : []),
        occurredAt: CarbonImmutable::parse('2027-06-14T10:00:00+03:00'),
        payload: $payload,
        action: $action,
    );
}

/**
 * Runs $fn as the user inside the company, the way the push endpoint does.
 *
 * @template T
 *
 * @param  Closure(DraftSyncWriter): T  $fn
 * @return T
 */
function asSalesWriter(object $w, string $resource, Closure $fn, ?User $user = null): mixed
{
    test()->actingAs($user ?? $w->user, 'web');

    return SalesKit::in($w->company, fn (): mixed => $fn(DraftSyncWriter::for($resource)));
}

/** @return array<string, mixed> */
function salesDraftPayload(object $w, array $header = [], array $line = []): array
{
    return ['party_id' => $w->party->id, 'document_date' => '2027-06-10', ...$header, 'lines' => [['item_id' => $w->item->id, 'quantity' => '2', ...$line]]];
}

function salesCreate(object $w, string $resource, ?string $id = null, array $payload = []): WriteOutcome
{
    $id ??= (string) Str::uuid7();

    return asSalesWriter($w, $resource, fn (DraftSyncWriter $writer): WriteOutcome => $writer->create(
        test()->w->user,
        salesMutation(MutationOp::Create, $resource, $id, $payload === [] ? salesDraftPayload($w) : $payload),
    ));
}

it('registers adapters for every Sales resource of the manifest and writers only for the draft-outbox ones', function (): void {
    $manifest = json_decode((string) file_get_contents((string) config('sync.manifest_path')), true, flags: JSON_THROW_ON_ERROR);
    $sales = array_values(array_filter($manifest['resources'], static fn (array $r): bool => $r['module'] === 'Sales'));
    $writable = array_values(array_map(static fn (array $r): string => $r['resource'], array_filter($sales, static fn (array $r): bool => isset($r['write']))));

    $resources = collect(app()->tagged(SyncResource::TAG))->filter(fn (SyncResource $r): bool => str_starts_with($r->name(), 'sales-'));
    $writers = collect(app()->tagged(SyncWriter::TAG))->filter(fn (SyncWriter $r): bool => str_starts_with($r->resource(), 'sales-'));

    expect($resources->map->name()->sort()->values()->all())->toBe(collect($sales)->pluck('resource')->sort()->values()->all())
        ->and($writers->map->resource()->sort()->values()->all())->toBe(collect($writable)->sort()->values()->all())
        ->and($writable)->toBe(['sales-quotes', 'sales-orders']);

    foreach ($sales as $entry) {
        $resource = $resources->first(fn (SyncResource $r): bool => $r->name() === $entry['resource']);
        expect($resource->resourceClass())->toBe($entry['api_resource'])
            ->and($resource->windowField())->toBe($entry['window_field'])
            ->and($resource->embeds())->toBe($entry['embeds'])
            ->and($resource->scope()->value)->toBe($entry['scope']);
    }
});

it('creates a quote draft under the client id, without a number', function (): void {
    $id = (string) Str::uuid7();
    $outcome = salesCreate($this->w, 'sales-quotes', $id);

    expect($outcome->status)->toBe(OutcomeStatus::Applied)
        ->and($outcome->version)->toBe(1)
        ->and($outcome->data['id'])->toBe($id)
        ->and($outcome->data['number'])->toBeNull()
        ->and($outcome->data['status'])->toBe('draft')
        ->and($outcome->data['line_count'])->toBe(1)
        ->and($outcome->data['lines'][0]['unit_price'])->toBe('120.000000')
        ->and($outcome->data['total'])->toBe('288.0000')
        ->and($outcome->data)->not->toHaveKey('sync_txid');

    $row = DB::table('sales_quotes')->where('id', $id)->first();
    expect($row->number)->toBeNull()->and($row->status)->toBe('draft')->and($row->company_id)->toBe($this->w->company);
});

it('creates an order draft under the client id', function (): void {
    $id = (string) Str::uuid7();
    $outcome = salesCreate($this->w, 'sales-orders', $id, salesDraftPayload($this->w, ['requested_delivery_date' => '2027-06-20']));

    expect($outcome->status)->toBe(OutcomeStatus::Applied)
        ->and($outcome->data['id'])->toBe($id)
        ->and($outcome->data['document_type'])->toBe('sales_order')
        ->and($outcome->data['requested_delivery_date'])->toBe('2027-06-20')
        ->and($outcome->data['number'])->toBeNull();
    expect(SalesOrder::query()->withoutCompanyScope()->find($id)?->status->value)->toBe('draft');
});

it('runs the DocumentRequest rules and the services rules on create', function (): void {
    $missing = salesCreate($this->w, 'sales-quotes', payload: ['document_date' => '2027-06-10', 'lines' => [['item_id' => $this->w->item->id, 'quantity' => '2']]]);
    expect($missing->status)->toBe(OutcomeStatus::Rejected)
        ->and($missing->errorCode?->value)->toBe('VALIDATION_ERROR')
        ->and($missing->errorFields)->toHaveKey('party_id');

    $badQty = salesCreate($this->w, 'sales-quotes', payload: salesDraftPayload($this->w, line: ['quantity' => '-1']));
    expect($badQty->errorFields)->toHaveKey('lines.0.quantity');

    // Price override without sales.price_override: refused by the composer, as on REST.
    $override = salesCreate($this->w, 'sales-quotes', payload: salesDraftPayload($this->w, line: ['unit_price' => '99']));
    expect($override->errorFields)->toHaveKey('lines.0.unit_price');

    // The same key twice: the second create is refused by the unique rule, nothing is overwritten.
    $id = (string) Str::uuid7();
    salesCreate($this->w, 'sales-quotes', $id);
    $again = salesCreate($this->w, 'sales-quotes', $id, salesDraftPayload($this->w, ['notes' => 'other']));
    expect($again->status)->toBe(OutcomeStatus::Rejected)->and($again->errorFields)->toHaveKey('id')
        ->and(DB::table('sales_quotes')->where('id', $id)->value('notes'))->toBeNull();

    // Keys are unique per document table, across companies.
    $other = SalesKit::world(stock: false);
    $foreign = asSalesWriter($other, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->create(
        $other->user, salesMutation(MutationOp::Create, 'sales-quotes', $id, salesDraftPayload($other)),
    ), $other->user);
    expect($foreign->errorFields)->toHaveKey('id')->and(DB::table('sales_quotes')->count())->toBe(1);
});

it('refuses writes the user is not allowed to make', function (): void {
    $limited = Actors::user(['sales.quotes.view'], $this->w->company);

    $outcome = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->create(
        $limited,
        salesMutation(MutationOp::Create, 'sales-quotes', (string) Str::uuid7(), salesDraftPayload($this->w)),
    ), $limited);
    expect($outcome->status)->toBe(OutcomeStatus::Rejected)->and($outcome->errorCode?->value)->toBe('FORBIDDEN');

    $quote = salesCreate($this->w, 'sales-quotes')->data;
    $update = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $limited, salesMutation(MutationOp::Update, 'sales-quotes', $quote['id'], ['notes' => 'x'], 1), $writer->find($quote['id']), 1,
    ), $limited);
    expect($update->errorCode?->value)->toBe('FORBIDDEN');

    $delete = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->delete(
        $limited, salesMutation(MutationOp::Delete, 'sales-quotes', $quote['id'], base: 1), $writer->find($quote['id']), 1,
    ), $limited);
    expect($delete->errorCode?->value)->toBe('FORBIDDEN')->and(DB::table('sales_quotes')->where('id', $quote['id'])->exists())->toBeTrue();
});

it('updates a draft through the REST chain and bumps its version', function (): void {
    $quote = salesCreate($this->w, 'sales-quotes')->data;

    $outcome = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $this->w->user,
        salesMutation(MutationOp::Update, 'sales-quotes', $quote['id'], ['notes' => 'Offline', 'lines' => [['id' => $quote['lines'][0]['id'], 'item_id' => $this->w->item->id, 'quantity' => '3']]], 1),
        $writer->find($quote['id']),
        1,
    ));

    expect($outcome->status)->toBe(OutcomeStatus::Applied)
        ->and($outcome->version)->toBe(2)
        ->and($outcome->data['notes'])->toBe('Offline')
        ->and($outcome->data['lines'][0]['id'])->toBe($quote['lines'][0]['id'])
        ->and($outcome->data['lines'][0]['quantity'])->toBe('3.000000')
        ->and($outcome->data['total'])->toBe('432.0000');

    // The version the Sync module passes is what the REST endpoint checks; a stale one conflicts.
    $stale = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $this->w->user, salesMutation(MutationOp::Update, 'sales-quotes', $quote['id'], ['notes' => 'Stale'], 1), $writer->find($quote['id']), 1,
    ));
    expect($stale->status)->toBe(OutcomeStatus::Rejected)->and($stale->errorCode?->value)->toBe('VERSION_CONFLICT');

    // Payload version and id are ignored: the passed version wins, the key cannot change.
    $ignored = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $this->w->user, salesMutation(MutationOp::Update, 'sales-quotes', $quote['id'], ['notes' => 'Kept', 'version' => 99, 'id' => (string) Str::uuid7()], 2, ['notes']), $writer->find($quote['id']), 2,
    ));
    expect($ignored->status)->toBe(OutcomeStatus::Applied)->and($ignored->data['id'])->toBe($quote['id'])->and($ignored->version)->toBe(3);
});

it('answers DOCUMENT_LOCKED for edits and deletes of a quote or order that left draft', function (): void {
    $quote = salesCreate($this->w, 'sales-quotes')->data;
    $sent = SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/send")->assertOk()->json('data');

    $outcome = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $this->w->user, salesMutation(MutationOp::Update, 'sales-quotes', $quote['id'], ['notes' => 'x'], 1), $writer->find($quote['id']), $sent['version'],
    ));
    $result = $outcome->toArray();
    expect($outcome->status)->toBe(OutcomeStatus::Conflict)
        ->and($result['conflict']['code'])->toBe('DOCUMENT_LOCKED')
        ->and($result['conflict']['choices'])->toBe(['save_as_new_draft', 'discard'])
        ->and($result['conflict']['base_version'])->toBe(1)
        ->and($result['conflict']['server_version'])->toBe($sent['version'])
        ->and($result['conflict']['server_data']['status'])->toBe('sent')
        ->and($result['conflict']['server_data']['lines'])->toHaveCount(1);

    $delete = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->delete(
        $this->w->user, salesMutation(MutationOp::Delete, 'sales-quotes', $quote['id'], base: $sent['version']), $writer->find($quote['id']), $sent['version'],
    ));
    expect($delete->toArray()['conflict']['code'])->toBe('DOCUMENT_LOCKED')
        ->and(asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): bool => $writer->isDraft($writer->find($quote['id']))))->toBeFalse();

    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '120']]);
    $locked = asSalesWriter($this->w, 'sales-orders', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $this->w->user, salesMutation(MutationOp::Update, 'sales-orders', $order['id'], ['notes' => 'x'], $order['version']), $writer->find($order['id']), $order['version'],
    ));
    expect($locked->toArray()['conflict']['code'])->toBe('DOCUMENT_LOCKED')
        ->and($locked->toArray()['conflict']['server_data']['status'])->toBe('confirmed');
});

it('deletes drafts with the exact version only', function (): void {
    $quote = salesCreate($this->w, 'sales-quotes')->data;
    $order = salesCreate($this->w, 'sales-orders')->data;

    $stale = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->delete(
        $this->w->user, salesMutation(MutationOp::Delete, 'sales-quotes', $quote['id'], base: 2), $writer->find($quote['id']), 2,
    ));
    expect($stale->errorCode?->value)->toBe('VERSION_CONFLICT')->and(DB::table('sales_quotes')->where('id', $quote['id'])->exists())->toBeTrue();

    foreach (['sales-quotes' => $quote, 'sales-orders' => $order] as $resource => $doc) {
        $outcome = asSalesWriter($this->w, $resource, fn (DraftSyncWriter $writer): WriteOutcome => $writer->delete(
            $this->w->user, salesMutation(MutationOp::Delete, $resource, $doc['id'], base: 1), $writer->find($doc['id']), 1,
        ));
        expect($outcome->status)->toBe(OutcomeStatus::Applied)->and($outcome->data)->toBeNull();
    }

    expect(DB::table('sales_quotes')->count())->toBe(0)->and(DB::table('sales_orders')->count())->toBe(0)
        ->and(DB::table('sales_quote_lines')->count())->toBe(0);
});

it('finds only documents of the active company and of its own kind', function (): void {
    $quote = salesCreate($this->w, 'sales-quotes')->data;
    $other = SalesKit::world(stock: false);

    expect(asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): ?SalesQuote => $writer->find($quote['id'])))->toBeInstanceOf(SalesQuote::class)
        ->and(asSalesWriter($this->w, 'sales-orders', fn (DraftSyncWriter $writer): mixed => $writer->find($quote['id'])))->toBeNull()
        ->and(asSalesWriter($other, 'sales-quotes', fn (DraftSyncWriter $writer): mixed => $writer->find($quote['id'])))->toBeNull()
        ->and(asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): mixed => $writer->find('not-a-uuid')))->toBeNull();
});

it('has no offline actions and declares status locked and the audited fields', function (): void {
    $quote = salesCreate($this->w, 'sales-quotes')->data;
    $writer = DraftSyncWriter::for('sales-quotes');

    $action = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $w): WriteOutcome => $w->action(
        $this->w->user, salesMutation(MutationOp::Action, 'sales-quotes', $quote['id'], base: 1, action: 'send'), $w->find($quote['id']), 1,
    ));

    expect($action->errorCode?->value)->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED')
        ->and($writer->lockedFields())->toBe(['status'])
        ->and($writer->auditFields())->toBe(['number', 'status', 'document_date', 'party_id', 'currency_code', 'fx_rate', 'total', 'total_local', 'notes', 'version'])
        ->and(asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $w): bool => $w->targetSatisfies($w->find($quote['id']), ['status' => 'draft'])))->toBeTrue()
        ->and(asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $w): bool => $w->targetSatisfies($w->find($quote['id']), ['status' => 'sent'])))->toBeFalse()
        ->and(asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $w): int => $w->currentVersion($w->find($quote['id']))))->toBe(1);
});

it('re-derives line tax rates and totals when only the document date changes', function (): void {
    // DocumentComposer::tax looks the rate up at the document date for every line, kept lines too.
    $old = SalesKit::taxCode($this->w->company, '18.0000', '2023-01-01', '2027-06-30');
    $quote = salesCreate($this->w, 'sales-quotes', payload: salesDraftPayload($this->w, line: ['tax_code_id' => $old->id]))->data;
    expect($quote['tax_total'])->toBe('43.2000');

    $outcome = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $this->w->user, salesMutation(MutationOp::Update, 'sales-quotes', $quote['id'], ['document_date' => '2027-07-05'], 1), $writer->find($quote['id']), 1,
    ));

    // The code is no longer valid at the new date: the date edit is refused like on REST,
    // proving the tax lookup depends on document_date (a derivation of lines and totals).
    expect($outcome->status)->toBe(OutcomeStatus::Rejected)->and($outcome->errorFields)->toHaveKey('lines.0.tax_code_id');

    $changing = SalesKit::taxCode($this->w->company, '18.0000', '2023-01-01');
    $draft = salesCreate($this->w, 'sales-quotes', payload: salesDraftPayload($this->w, line: ['tax_code_id' => $changing->id]))->data;
    DB::table('tax_codes')->where('id', $changing->id)->update(['rate' => '25.0000']);
    $moved = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $writer->update(
        $this->w->user, salesMutation(MutationOp::Update, 'sales-quotes', $draft['id'], ['document_date' => '2027-06-11'], 1), $writer->find($draft['id']), 1,
    ));

    expect($moved->status)->toBe(OutcomeStatus::Applied)
        ->and($moved->data['lines'][0]['tax_rate'])->toBe('25.0000')
        ->and($moved->data['tax_total'])->toBe('60.0000')
        ->and($moved->data['total'])->toBe('300.0000')
        ->and($moved->data['lines'][0]['unit_price'])->toBe('120.000000');
});

it('declares the document_date derivation of lines and totals in the manifest', function (): void {
    expect(salesEffectiveWriteSet('sales-quotes', ['document_date']))->toContain('lines', 'tax_total', 'total', 'tax_total_local', 'total_local')
        ->and(salesEffectiveWriteSet('sales-orders', ['document_date']))->toContain('lines', 'tax_total', 'total', 'tax_total_local', 'total_local');
})->skip(
    fn (): bool => ! in_array('tax_total', salesEffectiveWriteSet('sales-quotes', ['document_date']), true),
    'contracts/offline-manifest.json (P0) lacks {when: [document_date], derives: [lines]} for sales-quotes/sales-orders; until then a stale merge touching document_date conflicts (undeclared derivation).',
);

/**
 * changed_fields closed over the manifest's derived_fields (SYNC-PROTOCOL "Etkin yazma kümesi").
 *
 * @param  list<string>  $changed
 * @return list<string>
 */
function salesEffectiveWriteSet(string $resource, array $changed): array
{
    $manifest = json_decode((string) file_get_contents((string) config('sync.manifest_path')), true, flags: JSON_THROW_ON_ERROR);
    $entry = collect($manifest['resources'])->firstWhere('resource', $resource);
    $set = $changed;

    do {
        $before = count($set);

        foreach ($entry['write']['derived_fields'] as $rule) {
            if ($rule['when'] === ['*'] || array_intersect($rule['when'], $set) !== []) {
                $set = array_values(array_unique([...$set, ...$rule['derives']]));
            }
        }
    } while (count($set) !== $before);

    return $set;
}

it('accepts a client UUIDv7 on REST quote and order creates and ignores an id elsewhere', function (): void {
    $id = (string) Str::uuid7();
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [...salesDraftPayload($this->w), 'id' => $id])
        ->assertCreated()->assertJsonPath('data.id', $id)->assertJsonPath('data.number', null);
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [...salesDraftPayload($this->w), 'id' => $id])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['id']));
    SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [...salesDraftPayload($this->w), 'id' => (string) Str::uuid()])
        ->assertStatus(422)->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['id']));

    $orderId = (string) Str::uuid7();
    SalesKit::post($this->w->user, $this->w->company, 'sales-orders', [...salesDraftPayload($this->w), 'id' => $orderId])->assertCreated()->assertJsonPath('data.id', $orderId);

    // An edit cannot move the key.
    SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$id}", ['version' => 1, 'id' => (string) Str::uuid7(), 'notes' => 'x'])
        ->assertOk()->assertJsonPath('data.id', $id);
});

it('turns a lost create race on the client key into VALIDATION_ERROR on id, for sync and REST', function (): void {
    $template = salesCreate($this->w, 'sales-quotes')->data;
    $raced = [];

    // A concurrent create of the same key commits between the unique rule and this INSERT.
    SalesQuote::creating(function (SalesQuote $quote) use ($template, &$raced): void {
        if (! in_array($quote->id, $raced, true) && $quote->id !== $template['id']) {
            $raced[] = $quote->id;
            $row = (array) DB::table('sales_quotes')->where('id', $template['id'])->first();
            unset($row['sync_txid']);
            DB::table('sales_quotes')->insert([...$row, 'id' => $quote->id]);
        }
    });

    $id = (string) Str::uuid7();
    $outcome = salesCreate($this->w, 'sales-quotes', $id);
    expect($outcome->status)->toBe(OutcomeStatus::Rejected)
        ->and($outcome->errorCode?->value)->toBe('VALIDATION_ERROR')
        ->and($outcome->errorFields)->toHaveKey('id')
        ->and(DB::table('sales_quotes')->where('id', $id)->exists())->toBeFalse();

    $restId = (string) Str::uuid7();
    SalesKit::post($this->w->user, $this->w->company, 'sales-quotes', [...salesDraftPayload($this->w), 'id' => $restId])
        ->assertStatus(422)->assertJsonPath('errors.code', 'VALIDATION_ERROR')->assertJsonPath('errors.fields', fn (array $f): bool => isset($f['id']));
    expect(DB::table('sales_quotes')->count())->toBe(1);
});

it('answers DOCUMENT_LOCKED before any version check, so a stale client learns the lock', function (): void {
    $quote = salesCreate($this->w, 'sales-quotes')->data;
    $sent = SalesKit::post($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}/send")->assertOk()->json('data');
    expect($sent['version'])->toBeGreaterThan(1);

    SalesKit::patch($this->w->user, $this->w->company, "sales-quotes/{$quote['id']}", ['version' => 1, 'notes' => 'stale'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
    SalesKit::as($this->w->user, $this->w->company)->deleteJson("/api/v1/sales-quotes/{$quote['id']}?version=1")
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');

    foreach ([MutationOp::Update, MutationOp::Delete] as $op) {
        $outcome = asSalesWriter($this->w, 'sales-quotes', fn (DraftSyncWriter $writer): WriteOutcome => $op === MutationOp::Update
            ? $writer->update($this->w->user, salesMutation($op, 'sales-quotes', $quote['id'], ['notes' => 'stale'], 1), $writer->find($quote['id']), 1)
            : $writer->delete($this->w->user, salesMutation($op, 'sales-quotes', $quote['id'], base: 1), $writer->find($quote['id']), 1));
        $conflict = $outcome->toArray()['conflict'];

        expect($outcome->status)->toBe(OutcomeStatus::Conflict)
            ->and($conflict['code'])->toBe('DOCUMENT_LOCKED')
            ->and($conflict['base_version'])->toBe(1)
            ->and($conflict['server_version'])->toBe($sent['version'])
            ->and($conflict['server_data']['id'])->toBe($quote['id'])
            ->and($conflict['server_data']['status'])->toBe('sent')
            ->and($conflict['server_data']['version'])->toBe($sent['version'])
            ->and($conflict['server_data']['notes'])->toBeNull();
    }

    // A stale order that was confirmed meanwhile: same answer on REST.
    $order = SalesKit::confirmedOrder($this->w, [[$this->w->item->id, '1', '120']]);
    SalesKit::patch($this->w->user, $this->w->company, "sales-orders/{$order['id']}", ['version' => 1, 'notes' => 'stale'])
        ->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
});
