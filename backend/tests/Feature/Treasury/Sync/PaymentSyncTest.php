<?php

declare(strict_types=1);

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use App\Core\Sync\Mutation;
use App\Core\Sync\OutcomeStatus;
use App\Models\User;
use App\Modules\Sync\Services\Rows;
use App\Modules\Treasury\Enums\DocumentStatus;
use App\Modules\Treasury\Models\TreasuryPayment;
use App\Modules\Treasury\Sync\PaymentSyncResource;
use App\Modules\Treasury\Sync\PaymentSyncWriter;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Treasury\Core\TreasuryKit as T;
use Tests\Support\Actors;
use Tests\Support\Identity;
use Tests\Support\Purchasing\PurchKit as P;
use Tests\Support\Sync;

/*
 * `treasury-payments` offline drafts. Real HTTP: REST with a web session, sync push with a desktop
 * device token, the shipped contracts/offline-manifest.json and the real writer. Drafts only:
 * create, update and delete; the number, approval, posting, reversal and cancel stay online,
 * and a push never moves money.
 */
uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->w = T::world();
});

/**
 * @param  list<array<string, mixed>>  $mutations
 * @return list<array<string, mixed>>
 */
function tpsPush(User $user, string $company, array $mutations): array
{
    $headers = Sync::deviceHeaders($user, null, 'fp-treasury-sync-0001');
    $headers['X-Company-Id'] = $company;
    Identity::fresh();
    test()->flushHeaders();
    /** @var TestResponse $response */
    $response = test()->withHeaders($headers)->postJson('/api/v1/sync/push', ['schema_version' => 1, 'mutations' => $mutations]);
    $response->assertOk();

    /** @var list<array<string, mixed>> */
    return $response->json('data.results');
}

/** @return array<string, mixed> */
function tpsOne(User $user, string $company, array $mutation): array
{
    return tpsPush($user, $company, [$mutation])[0];
}

/**
 * @param  array<string, mixed>  $payload
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function tpsMutation(string $op, string $id, array $payload = [], ?int $base = null, array $overrides = []): array
{
    return [
        'idempotency_key' => (string) Str::uuid7(),
        'op' => $op,
        'resource' => 'treasury-payments',
        'id' => $id,
        'base_version' => $op === 'create' ? null : $base,
        'changed_fields' => in_array($op, ['update', 'action'], true) ? array_keys($payload) : [],
        'occurred_at' => '2027-06-12T10:00:00+03:00',
        'payload' => $payload === [] ? new stdClass : $payload,
        ...$overrides,
    ];
}

/**
 * The body the web payment editor sends (PaymentEditor.tsx), allocations and currency included.
 *
 * @param  array<string, mixed>  $extra
 * @return array<string, mixed>
 */
function tpsPayload(object $w, array $extra = []): array
{
    return [
        'direction' => 'payment', 'counterparty_module' => 'purchasing', 'account_id' => $w->cash['id'], 'party_id' => $w->party->id,
        'document_date' => '2027-06-12', 'fx_rate' => '1', 'amount' => '150', 'reference' => 'OFF-1',
        'description' => 'Kırtasiye masrafı', 'currency_code' => 'TRY', 'allocations' => [], ...$extra,
    ];
}

/** A draft created offline; returns its push result. */
function tpsDraft(object $w, array $extra = []): array
{
    $result = tpsOne($w->user, $w->company, tpsMutation('create', (string) Str::uuid7(), tpsPayload($w, $extra)));
    expect($result['status'])->toBe('applied');

    return $result;
}

/** @return array<string, int> */
function tpsLedger(): array
{
    return ['movements' => DB::table('treasury_movements')->count(), 'journals' => DB::table('journal_entries')->count(), 'numbers' => DB::table('treasury_payments')->whereNotNull('number')->count()];
}

it('is a tagged draft resource of the Treasury module', function (): void {
    $writers = array_map(fn ($x) => $x::class, iterator_to_array(app()->tagged(SyncWriter::TAG)));
    $resources = array_map(fn ($x) => $x::class, iterator_to_array(app()->tagged(SyncResource::TAG)));
    $writer = app(PaymentSyncWriter::class);

    expect($writers)->toContain(PaymentSyncWriter::class)->and($resources)->toContain(PaymentSyncResource::class)
        ->and($writer->lockedFields())->toContain('status', 'number', 'journal_entry_id', 'amount_local')
        ->and($writer->find('not-a-uuid'))->toBeNull()
        ->and(app(PaymentSyncResource::class)->windowField())->toBe('document_date');

    foreach (DocumentStatus::cases() as $case) {
        expect($writer->isDraft(new TreasuryPayment(['status' => $case->value])))->toBe($case === DocumentStatus::Draft, $case->value);
    }
});

it('creates a numberless draft under the client id, in the REST detail shape, without moving money', function (): void {
    $w = $this->w;
    $before = tpsLedger();
    $id = (string) Str::uuid7();
    $result = tpsOne($w->user, $w->company, tpsMutation('create', $id, tpsPayload($w)));

    expect($result['status'])->toBe('applied')
        ->and($result['version'])->toBe(1)
        ->and($result['data']['id'])->toBe($id)
        ->and($result['data']['number'])->toBeNull()
        ->and($result['data']['status'])->toBe('draft')
        ->and($result['data']['amount'])->toBe('150.0000')
        ->and($result['data']['fx_rate'])->toBe('1.000000')
        ->and($result['data']['currency_code'])->toBe('TRY')
        ->and($result['data']['created_by'])->toBe($w->user->id)
        ->and($result['data']['allocations'])->toBe([])
        ->and($result['data']['allocations_redacted'])->toBeFalse()
        ->and(array_key_exists('sync_txid', $result['data']))->toBeFalse()
        ->and(tpsLedger())->toBe($before);

    $rest = P::get($w->user, $w->company, "treasury-payments/{$id}")->assertOk()->json('data');
    $list = P::get($w->user, $w->company, 'treasury-payments')->assertOk()->json('data.0');
    expect($result['data'])->toBe($rest)->and(array_key_exists('sync_txid', $list))->toBeFalse();

    $pulled = P::in($w->company, fn () => app(Rows::class)->current(app(PaymentSyncResource::class), $w->company, $id));
    expect($pulled)->toBe($rest);
});

it('pulls allocations embedded, of the explicit company, as the REST detail shows them', function (): void {
    $w = $this->w;
    $invoice = T::invoice($w);
    $payment = T::payment($w, 'payment', '120', ['allocations' => [['invoice_module' => 'purchasing', 'invoice_id' => $invoice['id'], 'amount' => '100', 'fx_rate' => '1']]]);
    $rest = P::get($w->user, $w->company, "treasury-payments/{$payment['id']}")->assertOk()->json('data');
    expect($rest['allocations'])->toHaveCount(1)->and($rest['allocations'][0]['invoice_id'])->toBe($invoice['id']);

    $resource = app(PaymentSyncResource::class);
    $other = P::company();
    $read = fn () => app(Rows::class)->render($resource, $resource->query($w->company)->whereKey($payment['id'])->firstOrFail());
    P::as($w->user, $w->company);

    expect(P::in($w->company, $read))->toBe($rest)
        ->and(P::in($other, $read)['allocations'])->toHaveCount(0, 'a foreign ambient company sees no invoice access');
    expect($resource->query($other)->count())->toBe(0);
});

it('updates a draft, merges a stale edit of another field and conflicts on the same field', function (): void {
    $w = $this->w;
    $draft = tpsDraft($w);
    $id = $draft['data']['id'];

    $first = tpsOne($w->user, $w->company, tpsMutation('update', $id, ['description' => 'Toner', 'amount' => '175.5'], 1));
    expect($first['status'])->toBe('applied')->and($first['version'])->toBe(2)
        ->and($first['data']['amount'])->toBe('175.5000')->and($first['data']['description'])->toBe('Toner');

    // Edited offline on version 1, another field: merged over version 2.
    $merged = tpsOne($w->user, $w->company, tpsMutation('update', $id, ['reference' => 'OFF-2'], 1));
    expect($merged['status'])->toBe('applied')->and($merged['version'])->toBe(3)
        ->and($merged['merged_fields'])->toBe(['reference'])
        ->and($merged['data']['amount'])->toBe('175.5000')->and($merged['data']['reference'])->toBe('OFF-2');

    // The same field on a stale base: the server's value stays, the client gets the conflict.
    $stale = tpsOne($w->user, $w->company, tpsMutation('update', $id, ['amount' => '1'], 1));
    expect($stale['status'])->toBe('conflict')
        ->and($stale['conflict']['code'])->toBe('VERSION_CONFLICT')
        ->and($stale['conflict']['conflicting_fields'])->toBe(['amount'])
        ->and($stale['conflict']['server_data']['amount'])->toBe('175.5000');

    // Allocations are not in the payment's log: a stale edit that changes them always conflicts.
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '10', 'fx_rate' => '1'];
    $allocations = tpsOne($w->user, $w->company, tpsMutation('update', $id, ['allocations' => [$line]], 1));
    expect($allocations['status'])->toBe('conflict')->and($allocations['conflict']['conflicting_fields'])->toContain('allocations')
        ->and(DB::table('treasury_allocations')->where('payment_id', $id)->count())->toBe(0);
});

/**
 * The allocations as the payment editor resends them on every save (paymentAllocationInput).
 *
 * @param  list<array<string, mixed>>  $allocations
 * @return list<array<string, mixed>>
 */
function tpsResent(array $allocations): array
{
    return array_map(static fn (array $a): array => ['invoice_module' => $a['invoice_module'], 'invoice_id' => $a['invoice_id'], 'amount' => $a['amount'], 'fx_rate' => $a['fx_rate']], $allocations);
}

it('merges a stale edit that resends the allocations unchanged and leaves them as they are', function (): void {
    $w = $this->w;
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '100', 'fx_rate' => '1'];
    $payment = T::payment($w, 'payment', '120', ['allocations' => [$line]]);
    $served = P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => $payment['version'], 'description' => 'Web note'])->assertOk()->json('data');
    $rows = DB::table('treasury_allocations')->where('payment_id', $payment['id'])->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
    expect($served['version'])->toBe(2)->and($rows)->toHaveCount(1);

    // Edited offline on version 1: another field plus the allocations as the server served them.
    $merged = tpsOne($w->user, $w->company, tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => tpsResent($served['allocations'])], 1));
    expect($merged['status'])->toBe('applied')->and($merged['version'])->toBe(3)
        ->and($merged['merged_fields'])->toBe(['reference'])
        ->and($merged['data']['reference'])->toBe('OFF-9')->and($merged['data']['description'])->toBe('Web note')
        ->and(tpsResent($merged['data']['allocations']))->toBe(tpsResent($served['allocations']))
        ->and(DB::table('treasury_allocations')->where('payment_id', $payment['id'])->orderBy('id')->get()->map(fn ($r) => (array) $r)->all())->toBe($rows, 'the allocation rows are not rewritten');

    // The same allocations in the client's own notation ('100' / '1' instead of '100.0000' / '1.000000').
    $again = tpsOne($w->user, $w->company, tpsMutation('update', $payment['id'], ['amount' => '130', 'allocations' => [$line]], 1));
    expect($again['status'])->toBe('applied')->and($again['merged_fields'])->toBe(['amount'])
        ->and($again['data']['amount'])->toBe('130.0000')->and($again['data']['allocations'])->toHaveCount(1)
        ->and(DB::table('treasury_allocations')->where('payment_id', $payment['id'])->orderBy('id')->get()->map(fn ($r) => (array) $r)->all())->toBe($rows);
});

it('still conflicts when the server changed the allocations and a stale edit would overwrite them', function (): void {
    $w = $this->w;
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '100', 'fx_rate' => '1'];
    $payment = T::payment($w, 'payment', '120', ['allocations' => [$line]]);
    $served = P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => $payment['version'], 'allocations' => [[...$line, 'amount' => '50']]])->assertOk()->json('data');
    expect($served['version'])->toBe(2)->and($served['allocations'][0]['amount'])->toBe('50.0000');

    foreach ([[$line], [], [[...$line, 'fx_rate' => '1.5']]] as $i => $stale) {
        $result = tpsOne($w->user, $w->company, tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => $stale], 1));
        expect($result['status'])->toBe('conflict', "#{$i}")
            ->and($result['conflict']['code'])->toBe('VERSION_CONFLICT', "#{$i}")
            ->and($result['conflict']['conflicting_fields'])->toBe(['allocations'], "#{$i}")
            ->and($result['conflict']['server_data']['allocations'][0]['amount'])->toBe('50.0000', "#{$i}");
    }

    expect(DB::table('treasury_allocations')->where('payment_id', $payment['id'])->pluck('amount')->all())->toBe(['50.0000'])
        ->and(DB::table('treasury_payments')->where('id', $payment['id'])->first())->reference->toBeNull()->version->toBe(2);
});

/** @return list<array<string, mixed>> */
function tpsRows(string $paymentId): array
{
    return DB::table('treasury_allocations')->where('payment_id', $paymentId)->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
}

it('prunes only allocations REST would accept as sent: a shape violation is left to the validation', function (): void {
    $w = $this->w;
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '100', 'fx_rate' => '1'];
    $payment = T::payment($w, 'payment', '120', ['allocations' => [$line]]);
    P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => 1, 'description' => 'Web note'])->assertOk()->assertJsonPath('data.version', 2);
    $rows = tpsRows($payment['id']);

    // Each equals the stored line once normalised, yet REST refuses the shape (string + regex, exact keys).
    $invalid = [
        'five decimals' => [[...$line, 'amount' => '100.00001']],
        'exponent' => [[...$line, 'amount' => '1e2']],
        'integer amount' => [[...$line, 'amount' => 100]],
        'integer rate' => [[...$line, 'fx_rate' => 1]],
        'seven rate decimals' => [[...$line, 'fx_rate' => '1.0000001']],
        'extra key id' => [[...$line, 'id' => $rows[0]['id']]],
        'extra key carrying_amount' => [[...$line, 'carrying_amount' => '100.0000']],
    ];
    // REST takes these (an object passes `array`, a missing rate is computed), yet they are not the editor's shape: never pruned.
    $unpruned = ['object instead of list' => ['x' => $line], 'no rate' => [array_diff_key($line, ['fx_rate' => true])]];

    foreach ([...$invalid, ...$unpruned] as $label => $allocations) {
        $stale = tpsOne($w->user, $w->company, tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => $allocations], 1));
        expect($stale['status'])->toBe('conflict', $label)->and($stale['conflict']['conflicting_fields'])->toBe(['allocations'], $label);
    }

    foreach ($invalid as $label => $allocations) {
        $current = tpsOne($w->user, $w->company, tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => $allocations], 2));
        $rest = P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => 2, 'reference' => 'OFF-9', 'allocations' => $allocations]);
        expect($current['status'])->toBe('rejected', $label)->and($current['error']['code'])->toBe('VALIDATION_ERROR', $label)
            ->and(array_keys($current['error']['fields']))->toBe(array_keys($rest->assertStatus(422)->json('errors.fields')), $label);
    }

    expect(tpsRows($payment['id']))->toBe($rows)
        ->and(DB::table('treasury_payments')->where('id', $payment['id'])->first())->reference->toBeNull()->version->toBe(2);
});

it('replays a stored allocation conflict as stored, even once the server came to match the client', function (): void {
    $w = $this->w;
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '100', 'fx_rate' => '1'];
    $payment = T::payment($w, 'payment', '120', ['allocations' => [$line]]);
    P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => 1, 'allocations' => [[...$line, 'amount' => '50']]])->assertOk();
    $mutation = tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => [$line]], 1);

    $first = tpsOne($w->user, $w->company, $mutation);
    expect($first['status'])->toBe('conflict')->and($first['conflict']['conflicting_fields'])->toBe(['allocations'])->and($first['conflict']['server_version'])->toBe(2);

    // The web puts the allocations back to what the client sent; the same key must answer the same conflict.
    P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => 2, 'allocations' => [$line]])->assertOk()->assertJsonPath('data.version', 3);
    $again = tpsOne($w->user, $w->company, $mutation);

    expect($again['status'])->toBe('conflict')->and($again['replayed'])->toBeTrue()
        ->and($again['conflict']['code'])->toBe('VERSION_CONFLICT')
        ->and($again['conflict']['conflicting_fields'])->toBe(['allocations'])
        ->and($again['conflict']['base_version'])->toBe(1)->and($again['conflict']['server_version'])->toBe(3)
        ->and($again['conflict']['choices'])->toBe($first['conflict']['choices'])
        ->and(DB::table('treasury_payments')->where('id', $payment['id'])->first())->reference->toBeNull()->version->toBe(3);
});

it('does not prune for a user who cannot see every stored allocation', function (): void {
    $w = $this->w;
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '100', 'fx_rate' => '1'];
    $payment = T::payment($w, 'payment', '120', ['allocations' => [$line]]);
    P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => 1, 'description' => 'Web note'])->assertOk()->assertJsonPath('data.version', 2);
    $rows = tpsRows($payment['id']);
    $blind = Actors::user(['treasury.payments.view', 'treasury.payments.update', 'treasury.accounts.view'], $w->company);

    // Equal or not cannot be probed without purchasing.invoices.view: the stale base conflicts as before...
    $stale = tpsOne($blind, $w->company, tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => [$line]], 1));
    expect($stale['status'])->toBe('conflict')->and($stale['conflict']['conflicting_fields'])->toBe(['allocations']);

    // ...and on the current base REST refuses to rewrite allocations the user cannot see.
    $current = tpsOne($blind, $w->company, tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => [$line]], 2));
    expect($current['status'])->toBe('rejected')->and($current['error']['code'])->toBe('FORBIDDEN')
        ->and(tpsRows($payment['id']))->toBe($rows)
        ->and(DB::table('treasury_payments')->where('id', $payment['id'])->first())->reference->toBeNull()->version->toBe(2);
});

it('replays a pruned merge from the stored result without a second write', function (): void {
    $w = $this->w;
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '100', 'fx_rate' => '1'];
    $payment = T::payment($w, 'payment', '120', ['allocations' => [$line]]);
    P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => 1, 'description' => 'Web note'])->assertOk();
    $mutation = tpsMutation('update', $payment['id'], ['reference' => 'OFF-9', 'allocations' => [$line]], 1);

    $first = tpsOne($w->user, $w->company, $mutation);
    expect($first['status'])->toBe('applied')->and($first['version'])->toBe(3)->and($first['merged_fields'])->toBe(['reference']);
    $rows = tpsRows($payment['id']);

    $again = tpsOne($w->user, $w->company, $mutation);
    expect($again['status'])->toBe('duplicate')->and($again['replayed'])->toBeTrue()
        ->and($again['data'])->toBe($first['data'])->and($again['merged_fields'] ?? null)->toBe(['reference'])
        ->and(tpsRows($payment['id']))->toBe($rows)
        ->and(DB::table('treasury_payments')->where('id', $payment['id'])->value('version'))->toBe(3);
});

it('applies a current-base edit that only resends the allocations without rewriting them', function (): void {
    $w = $this->w;
    $line = ['invoice_module' => 'purchasing', 'invoice_id' => T::invoice($w)['id'], 'amount' => '100', 'fx_rate' => '1'];
    $payment = T::payment($w, 'payment', '120', ['allocations' => [$line]]);
    $rows = tpsRows($payment['id']);

    $result = tpsOne($w->user, $w->company, tpsMutation('update', $payment['id'], ['allocations' => [$line]], 1));
    expect($result['status'])->toBe('applied')->and($result['version'])->toBe(1)
        ->and(array_key_exists('merged_fields', $result))->toBeFalse()
        ->and($result['data']['version'])->toBe(1)->and($result['data']['allocations'])->toHaveCount(1)
        ->and(tpsRows($payment['id']))->toBe($rows)
        ->and(DB::table('treasury_payments')->where('id', $payment['id'])->value('version'))->toBe(1);
});

it('treats an empty allocations list resent for a payment without any as unchanged', function (): void {
    $w = $this->w;
    $id = tpsDraft($w)['data']['id'];
    P::patch($w->user, $w->company, "treasury-payments/{$id}", ['version' => 1, 'description' => 'Web note'])->assertOk()->assertJsonPath('data.version', 2);

    $merged = tpsOne($w->user, $w->company, tpsMutation('update', $id, ['reference' => 'OFF-9', 'allocations' => []], 1));
    expect($merged['status'])->toBe('applied')->and($merged['version'])->toBe(3)->and($merged['merged_fields'])->toBe(['reference'])
        ->and($merged['data']['allocations'])->toBe([])->and($merged['data']['description'])->toBe('Web note');
});

it('leaves the guard as it found it: empty stays empty, a switched user comes back', function (): void {
    $w = $this->w;
    $writer = app(PaymentSyncWriter::class);
    $create = fn (): Mutation => Mutation::fromArray(tpsMutation('create', (string) Str::uuid7(), tpsPayload($w)));
    Identity::fresh();

    expect(Auth::guard()->hasUser())->toBeFalse();
    $outcome = P::in($w->company, fn () => $writer->create($w->user, $create()));
    expect($outcome->status)->toBe(OutcomeStatus::Applied)
        ->and(Auth::guard()->hasUser())->toBeFalse()->and(Auth::user())->toBeNull();

    $other = Actors::user(['treasury.payments.view'], $w->company);
    Auth::setUser($other);
    $outcome = P::in($w->company, fn () => $writer->create($w->user, $create()));
    expect($outcome->status)->toBe(OutcomeStatus::Applied)->and(Auth::user()?->is($other))->toBeTrue();
});

it('replays a repeated push without a second write', function (): void {
    $w = $this->w;
    $mutation = tpsMutation('create', (string) Str::uuid7(), tpsPayload($w));
    $first = tpsOne($w->user, $w->company, $mutation);
    $again = tpsOne($w->user, $w->company, $mutation);

    expect($first['status'])->toBe('applied')
        ->and($again['status'])->toBe('duplicate')->and($again['replayed'])->toBeTrue()
        ->and($again['data'])->toBe($first['data'])
        ->and(DB::table('treasury_payments')->where('id', $mutation['id'])->count())->toBe(1);

    $reused = tpsOne($w->user, $w->company, [...$mutation, 'payload' => tpsPayload($w, ['amount' => '9'])]);
    expect($reused['status'])->toBe('rejected')->and($reused['error']['code'])->toBe('IDEMPOTENCY_KEY_REUSED');
});

it('refuses what only the server sets: number, status and the posting results', function (): void {
    $w = $this->w;
    $draft = tpsDraft($w);
    $id = $draft['data']['id'];

    foreach ([
        tpsMutation('create', (string) Str::uuid7(), tpsPayload($w, ['number' => 'TP-2027-000001'])),
        tpsMutation('create', (string) Str::uuid7(), tpsPayload($w, ['status' => 'posted'])),
        tpsMutation('update', $id, ['number' => 'TP-2027-000001'], 1),
        tpsMutation('update', $id, ['status' => 'approved'], 1),
        tpsMutation('update', $id, ['journal_entry_id' => (string) Str::uuid7()], 1),
        tpsMutation('update', $id, ['amount_local' => '1'], 1),
    ] as $i => $mutation) {
        $result = tpsOne($w->user, $w->company, $mutation);
        expect($result['status'])->toBe('rejected', "#{$i}")->and($result['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED', "#{$i}");
    }

    expect(DB::table('treasury_payments')->where('id', $id)->first())
        ->number->toBeNull()->status->toBe('draft')->version->toBe(1);
});

it('keeps submit, post, reverse and cancel online', function (): void {
    $w = $this->w;
    $before = tpsLedger();
    $id = tpsDraft($w)['data']['id'];

    foreach (['submit', 'post', 'reverse', 'cancel'] as $action) {
        $result = tpsOne($w->user, $w->company, tpsMutation('action', $id, ['note' => 'x'], 1, ['action' => $action]));
        expect($result['status'])->toBe('rejected', $action)->and($result['error']['code'])->toBe('SYNC_OFFLINE_WRITE_NOT_ALLOWED', $action);
    }

    expect(DB::table('treasury_payments')->where('id', $id)->value('status'))->toBe('draft')
        ->and(tpsLedger())->toBe($before);
});

it('validates amounts, currency, rate, account and party exactly as REST does', function (): void {
    $w = $this->w;
    $usd = T::account($w, 'USDBANK', 'bank', '102', 'USD');
    DB::table('treasury_accounts')->where('id', $w->bank['id'])->update(['is_active' => false]);
    $cases = [
        'negative amount' => ['amount' => '-5'],
        'amount as text' => ['amount' => 'many'],
        'zero amount' => ['amount' => '0'],
        'too many decimals' => ['amount' => '1.23456'],
        'currency of another account' => ['currency_code' => 'USD'],
        'rate on the base currency' => ['fx_rate' => '2'],
        'foreign account without rate source' => ['account_id' => $usd['id'], 'currency_code' => 'USD', 'fx_rate' => '0'],
        'inactive account' => ['account_id' => $w->bank['id']],
        'unknown account' => ['account_id' => (string) Str::uuid7()],
        'unknown party' => ['party_id' => (string) Str::uuid7()],
        'unknown key' => ['foo' => 'bar'],
        'bad direction' => ['direction' => 'sideways'],
        'bad date' => ['document_date' => '12.06.2027'],
        'foreign invoice allocation' => ['allocations' => [['invoice_module' => 'purchasing', 'invoice_id' => (string) Str::uuid7(), 'amount' => '10', 'fx_rate' => '1']]],
    ];

    foreach ($cases as $label => $extra) {
        $payload = tpsPayload($w, $extra);
        $rest = P::post($w->user, $w->company, 'treasury-payments', $payload);
        $sync = tpsOne($w->user, $w->company, tpsMutation('create', (string) Str::uuid7(), $payload));

        expect($rest->status())->toBe(422, $label)
            ->and($sync['status'])->toBe('rejected', $label)
            ->and($sync['error']['code'])->toBe('VALIDATION_ERROR', $label)
            ->and(array_keys($sync['error']['fields']))->toBe(array_keys($rest->json('errors.fields')), $label);
    }

    expect(DB::table('treasury_payments')->count())->toBe(0);
});

it('takes a client id once, as the REST create does', function (): void {
    $w = $this->w;
    $id = (string) Str::uuid7();
    P::post($w->user, $w->company, 'treasury-payments', ['id' => $id, ...tpsPayload($w)])->assertCreated()->assertJsonPath('data.id', $id);
    P::post($w->user, $w->company, 'treasury-payments', ['id' => $id, ...tpsPayload($w)])->assertStatus(422)->assertJsonPath('errors.fields.id.0', fn ($m) => is_string($m));
    P::post($w->user, $w->company, 'treasury-payments', ['id' => (string) Str::uuid(), ...tpsPayload($w)])->assertStatus(422);
    P::patch($w->user, $w->company, "treasury-payments/{$id}", ['id' => $id, 'version' => 1, 'description' => 'x'])->assertStatus(422);

    $taken = tpsOne($w->user, $w->company, tpsMutation('create', $id, tpsPayload($w)));
    expect($taken['status'])->toBe('rejected')->and($taken['error']['fields'])->toHaveKey('id');
});

it('needs the same treasury payment permission as REST for each operation', function (): void {
    $w = $this->w;
    $id = tpsDraft($w)['data']['id'];
    $as = static fn (array $permissions): User => Actors::user($permissions, $w->company);
    $create = tpsMutation('create', (string) Str::uuid7(), tpsPayload($w));
    $update = tpsMutation('update', $id, ['description' => 'x'], 1);
    $delete = tpsMutation('delete', $id, [], 1);

    $viewer = $as(['treasury.payments.view', 'treasury.accounts.view']);
    foreach ([$create, $update, $delete] as $mutation) {
        expect(tpsOne($viewer, $w->company, $mutation)['error']['code'])->toBe('FORBIDDEN', $mutation['op']);
    }

    $creator = $as(['treasury.payments.view', 'treasury.payments.create']);
    expect(tpsOne($creator, $w->company, $update)['error']['code'])->toBe('FORBIDDEN')
        ->and(tpsOne($creator, $w->company, $delete)['error']['code'])->toBe('FORBIDDEN');
    P::patch($creator, $w->company, "treasury-payments/{$id}", ['version' => 1, 'description' => 'x'])->assertForbidden();

    $editor = $as(['treasury.payments.view', 'treasury.payments.update']);
    expect(tpsOne($editor, $w->company, $delete)['error']['code'])->toBe('FORBIDDEN');

    // A refusal is not stored: with the permission the same key goes through.
    expect(tpsOne($w->user, $w->company, $update)['status'])->toBe('applied');
    expect(DB::table('treasury_payments')->where('id', $id)->value('version'))->toBe(2);
});

it('needs the invoice permission of the allocations it rewrites, like REST', function (): void {
    $w = $this->w;
    $invoice = T::invoice($w);
    $payment = T::payment($w, 'payment', '120', ['allocations' => [['invoice_module' => 'purchasing', 'invoice_id' => $invoice['id'], 'amount' => '100', 'fx_rate' => '1']]]);
    $blind = Actors::user(['treasury.payments.view', 'treasury.payments.update', 'treasury.accounts.view'], $w->company);

    P::patch($blind, $w->company, "treasury-payments/{$payment['id']}", ['version' => $payment['version'], 'description' => 'x'])->assertForbidden();
    $result = tpsOne($blind, $w->company, tpsMutation('update', $payment['id'], ['description' => 'x', 'allocations' => []], $payment['version']));

    expect($result['error']['code'])->toBe('FORBIDDEN')
        ->and(DB::table('treasury_allocations')->where('payment_id', $payment['id'])->count())->toBe(1);
});

it('keeps another company out: its payments are not found and its ids are taken', function (): void {
    $w = $this->w;
    $theirs = T::payment($w);
    $other = T::world();

    $update = tpsOne($other->user, $other->company, tpsMutation('update', $theirs['id'], ['description' => 'x'], 1));
    $delete = tpsOne($other->user, $other->company, tpsMutation('delete', $theirs['id'], [], 1));
    $create = tpsOne($other->user, $other->company, tpsMutation('create', $theirs['id'], tpsPayload($other)));
    $crossed = tpsOne($other->user, $other->company, tpsMutation('create', (string) Str::uuid7(), tpsPayload($other, ['account_id' => $w->cash['id']])));

    expect($update['error']['code'])->toBe('NOT_FOUND')
        ->and($delete['error']['code'])->toBe('NOT_FOUND')
        ->and($create['error']['code'])->toBe('VALIDATION_ERROR')->and($create['error']['fields'])->toHaveKey('id')
        ->and($crossed['error']['code'])->toBe('VALIDATION_ERROR')
        ->and(DB::table('treasury_payments')->where('id', $theirs['id'])->first())->description->toBeNull()->company_id->toBe($w->company);
});

it('answers DOCUMENT_LOCKED for approved, posted and cancelled payments, on push and on REST', function (): void {
    $w = $this->w;
    T::opening($w, $w->cash);
    $approved = P::post($w->user, $w->company, 'treasury-payments/'.T::payment($w)['id'].'/submit', ['version' => 1])->assertOk()->assertJsonPath('data.status', 'approved')->json('data');
    $posted = T::post($w, T::payment($w));
    $cancelled = P::post($w->user, $w->company, 'treasury-payments/'.T::payment($w)['id'].'/cancel', ['version' => 1])->assertOk()->json('data');
    $before = tpsLedger();

    foreach (['approved' => $approved, 'posted' => $posted, 'cancelled' => $cancelled] as $status => $payment) {
        $row = (array) DB::table('treasury_payments')->where('id', $payment['id'])->first();

        foreach ([$payment['version'], 1] as $base) {
            foreach ([tpsMutation('update', $payment['id'], ['description' => 'late', 'amount' => '1'], $base), tpsMutation('delete', $payment['id'], [], $base)] as $mutation) {
                $result = tpsOne($w->user, $w->company, $mutation);
                expect($result['status'])->toBe('conflict', "{$status} {$mutation['op']} @{$base}")
                    ->and($result['conflict']['code'])->toBe('DOCUMENT_LOCKED')
                    ->and($result['conflict']['server_data']['status'])->toBe($status)
                    ->and($result['conflict']['server_version'])->toBe($payment['version']);
            }
        }

        P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => $payment['version'], 'description' => 'late'])->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
        P::as($w->user, $w->company)->deleteJson("/api/v1/treasury-payments/{$payment['id']}?version={$payment['version']}")->assertStatus(409)->assertJsonPath('errors.code', 'DOCUMENT_LOCKED');
        expect((array) DB::table('treasury_payments')->where('id', $payment['id'])->first())->toBe($row, $status);
    }

    expect(tpsLedger())->toBe($before);
});

it('deletes a draft with its allocations and leaves a tombstone', function (): void {
    $w = $this->w;
    $invoice = T::invoice($w);
    $payment = T::payment($w, 'payment', '120', ['allocations' => [['invoice_module' => 'purchasing', 'invoice_id' => $invoice['id'], 'amount' => '100', 'fx_rate' => '1']]]);

    $stale = tpsOne($w->user, $w->company, tpsMutation('delete', $payment['id'], [], $payment['version'] + 1));
    expect($stale['error']['code'])->toBe('SYNC_BASE_VERSION_AHEAD');

    $result = tpsOne($w->user, $w->company, tpsMutation('delete', $payment['id'], [], $payment['version']));
    expect($result['status'])->toBe('applied')->and($result['data'] ?? null)->toBeNull()
        ->and(DB::table('treasury_payments')->where('id', $payment['id'])->exists())->toBeFalse()
        ->and(DB::table('treasury_allocations')->where('payment_id', $payment['id'])->exists())->toBeFalse()
        ->and(Sync::tombstone('treasury_payments', $payment['id']))->not->toBeNull();
    P::get($w->user, $w->company, 'purchase-invoices/'.$invoice['id'])->assertJsonPath('data.balance_due', '120.0000');
});

it('moves the version when only the allocations change, and they touch the payment', function (): void {
    $w = $this->w;
    T::opening($w, $w->cash);
    $invoice = T::invoice($w);
    $payment = T::payment($w, 'payment', '120');

    $updated = P::patch($w->user, $w->company, "treasury-payments/{$payment['id']}", ['version' => $payment['version'], 'allocations' => [['invoice_module' => 'purchasing', 'invoice_id' => $invoice['id'], 'amount' => '50', 'fx_rate' => '1']]])->assertOk()->json('data');

    expect($updated['version'])->toBe($payment['version'] + 1)
        ->and($updated['allocations'])->toHaveCount(1)
        ->and(DB::table('pg_trigger')->whereRaw("tgrelid = 'treasury_allocations'::regclass")->pluck('tgname')->all())
        ->toContain('sync_parent_treasury_payments_insert', 'sync_parent_treasury_payments_update', 'sync_parent_treasury_payments_delete');

    // A posted payment keeps its allocations and its row: the guard refuses, nothing is touched.
    $posted = T::post($w, [...$updated, 'version' => $updated['version']]);
    expect(fn () => DB::table('treasury_allocations')->where('payment_id', $posted['id'])->update(['amount' => '1']))->toThrow(QueryException::class);
});
