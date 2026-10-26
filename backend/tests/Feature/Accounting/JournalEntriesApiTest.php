<?php

declare(strict_types=1);

use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Models\JournalEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->clerk = Actors::user(['accounting.entries.view', 'accounting.entries.create']);
    $this->poster = Actors::user(['accounting.entries.view', 'accounting.entries.post']);
    $this->reverser = Actors::user(['accounting.entries.view', 'accounting.entries.reverse']);
    $this->party = Books::$parties[0];
    $this->draft = [
        'entry_type' => 'receipt',
        'entry_date' => '2027-06-10',
        'description' => 'Tahsilat',
        'lines' => [
            ['account_code' => '100', 'debit' => '250.50', 'description' => 'Kasa'],
            ['account_id' => Books::account($this->company, '120')->id, 'credit' => '250.50', 'party_id' => Books::$parties[0], 'due_date' => '2027-07-10', 'document_ref' => 'MAK-1'],
        ],
    ];
});

it('creates a draft, edits it with version locking, posts it and shows lines with audit', function (): void {
    $draft = Books::postJson($this->clerk, $this->company, 'journal-entries', [...$this->draft, 'lines' => [['account_code' => '100', 'debit' => '250.50']]])
        ->assertCreated()
        ->assertJsonPath('data.status', 'draft')
        ->assertJsonPath('data.number', null)
        ->assertJsonPath('data.total_debit', '250.5000')
        ->assertJsonPath('data.difference', '250.5000')
        ->json('data');

    Books::postJson($this->poster, $this->company, "journal-entries/{$draft['id']}/post")
        ->assertStatus(422)->assertJsonValidationErrors(['lines'], 'errors.fields');

    Books::as($this->clerk, $this->company)->patchJson("/api/v1/journal-entries/{$draft['id']}", ['lines' => $this->draft['lines']])
        ->assertStatus(422)->assertJsonValidationErrors(['version'], 'errors.fields');
    Books::as($this->clerk, $this->company)->patchJson("/api/v1/journal-entries/{$draft['id']}", ['lines' => $this->draft['lines'], 'version' => 1])
        ->assertOk()->assertJsonPath('data.version', 2)->assertJsonPath('data.difference', '0.0000')->assertJsonCount(2, 'data.lines');
    Books::as($this->clerk, $this->company)->patchJson("/api/v1/journal-entries/{$draft['id']}", ['description' => 'stale', 'version' => 1])->assertStatus(409);

    Books::postJson($this->poster, $this->company, "journal-entries/{$draft['id']}/post", ['version' => 1])->assertStatus(409);
    Books::postJson($this->poster, $this->company, "journal-entries/{$draft['id']}/post", ['version' => 2])
        ->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', '2027000000001')->assertJsonPath('data.posted_by', $this->poster->id);

    $shown = Books::as($this->clerk, $this->company)->getJson("/api/v1/journal-entries/{$draft['id']}")->assertOk()->json('data');
    expect($shown['lines'][1])->toMatchArray([
        'account_code' => '120', 'account_name' => 'ALICILAR', 'credit' => '250.5000', 'debit' => '0.0000',
        'party_id' => $this->party, 'due_date' => '2027-07-10', 'document_ref' => 'MAK-1',
    ])->and($shown['created_by'])->toBe($this->clerk->id)
        ->and(collect($shown['audit'])->pluck('event')->all())->toContain('created', 'updated');

    Books::as($this->clerk, $this->company)->patchJson("/api/v1/journal-entries/{$draft['id']}", ['description' => 'x', 'version' => 3])
        ->assertStatus(422)->assertJsonValidationErrors(['entry'], 'errors.fields');
    Books::as($this->clerk, $this->company)->deleteJson("/api/v1/journal-entries/{$draft['id']}")
        ->assertStatus(422)->assertJsonValidationErrors(['entry'], 'errors.fields');
    Books::postJson($this->poster, $this->company, "journal-entries/{$draft['id']}/post")->assertStatus(422);
});

it('validates drafts: money as strings, line limits, manual types, periods and dimensions', function (array $patch, string $field): void {
    Books::postJson($this->clerk, $this->company, 'journal-entries', array_replace_recursive($this->draft, $patch))
        ->assertStatus(422)->assertJsonValidationErrors([$field], 'errors.fields');
})->with([
    'float amount' => [['lines' => [['debit' => 250.5]]], 'lines.0.debit'],
    'too many decimals' => [['lines' => [['debit' => '1.23456']]], 'lines.0.debit'],
    'generated type' => [['entry_type' => 'closing'], 'entry_type'],
    'no period' => [['entry_date' => '2031-01-01'], 'entry_date'],
    'unknown party' => [['lines' => [1 => ['party_id' => '01900000-0000-7000-8000-000000000000']]], 'lines.1.party_id'],
    'heading account' => [['lines' => [['account_code' => '10']]], 'lines.0.account_id'],
    'no account' => [['lines' => [['account_code' => null]]], 'lines.0.account_id'],
    'both sides' => [['lines' => [['credit' => '1']]], 'lines.0.debit'],
    'bad currency' => [['lines' => [['currency_code' => 'XXX']]], 'lines.0.currency_code'],
]);

it('caps drafts at 500 lines', function (): void {
    $lines = array_fill(0, 501, ['account_code' => '100', 'debit' => '1']);

    Books::postJson($this->clerk, $this->company, 'journal-entries', [...$this->draft, 'lines' => $lines])
        ->assertStatus(422)->assertJsonValidationErrors(['lines'], 'errors.fields');
});

it('requires the post_soft_closed permission to post into a soft-closed period', function (): void {
    $draft = Books::postJson($this->clerk, $this->company, 'journal-entries', $this->draft)->json('data');
    Books::period($this->company, '2027', 6)->forceFill(['status' => 'soft_closed'])->save();

    Books::postJson($this->poster, $this->company, "journal-entries/{$draft['id']}/post")
        ->assertStatus(422)->assertJsonValidationErrors(['entry_date'], 'errors.fields');
    Books::postJson(Actors::user(['accounting.entries.post', 'accounting.entries.post_soft_closed']), $this->company, "journal-entries/{$draft['id']}/post")
        ->assertOk()->assertJsonPath('data.status', 'posted');
});

it('reverses posted entries with a date and a reason', function (): void {
    $entry = Books::post($this->company, '2027-06-10', [['100', '40', '0'], ['600', '0', '40']]);

    Books::postJson($this->reverser, $this->company, "journal-entries/{$entry->id}/reverse", ['date' => '2027-06-11'])
        ->assertStatus(422)->assertJsonValidationErrors(['reason'], 'errors.fields');
    $reversal = Books::postJson($this->reverser, $this->company, "journal-entries/{$entry->id}/reverse", ['date' => '2027-06-11', 'reason' => 'Hatalı kayıt'])
        ->assertCreated()
        ->assertJsonPath('data.entry_type', 'reversal')
        ->assertJsonPath('data.reverses_id', $entry->id)
        ->assertJsonPath('data.lines.0.credit', '40.0000')
        ->json('data');

    Books::as($this->reverser, $this->company)->getJson("/api/v1/journal-entries/{$entry->id}")
        ->assertJsonPath('data.status', 'reversed')->assertJsonPath('data.reversed_by_id', $reversal['id']);
    Books::postJson($this->reverser, $this->company, "journal-entries/{$entry->id}/reverse", ['date' => '2027-06-11', 'reason' => 'again'])
        ->assertStatus(422);
    Books::postJson($this->reverser, $this->company, "journal-entries/{$reversal['id']}/reverse", ['date' => '2031-06-11', 'reason' => 'no period'])
        ->assertStatus(422)->assertJsonValidationErrors(['entry_date'], 'errors.fields');
    expect(Books::balance($this->company, '100'))->toBe('0.0000');
});

it('replays a create with the same idempotency key', function (): void {
    $key = (string) Str::uuid7();
    $first = Books::as($this->clerk, $this->company)->postJson('/api/v1/journal-entries', $this->draft, ['Idempotency-Key' => $key])->assertCreated();
    $second = Books::as($this->clerk, $this->company)->postJson('/api/v1/journal-entries', $this->draft, ['Idempotency-Key' => $key])->assertCreated();

    expect($second->json('data.id'))->toBe($first->json('data.id'))
        ->and(Books::in($this->company, fn () => JournalEntry::query()->count()))->toBe(1);
    Books::as($this->clerk, $this->company)->postJson('/api/v1/journal-entries', $this->draft)->assertStatus(400);
});

it('deletes drafts only', function (): void {
    $draft = Books::postJson($this->clerk, $this->company, 'journal-entries', $this->draft)->json('data');

    Books::as($this->clerk, $this->company)->deleteJson("/api/v1/journal-entries/{$draft['id']}?version=2")->assertStatus(409);
    Books::as($this->clerk, $this->company)->deleteJson("/api/v1/journal-entries/{$draft['id']}")->assertNoContent();
    expect(Books::in($this->company, fn () => JournalEntry::query()->count()))->toBe(0);
});

it('filters the list by date, type, status, account, party, amount and text', function (): void {
    Books::post($this->company, '2027-02-01', [['100', '10', '0'], ['600', '0', '10']]);
    Books::post($this->company, '2027-03-01', [['120', '500', '0', ['partyId' => $this->party]], ['600', '0', '500']]);
    Books::post($this->company, '2027-04-01', [['102', '75', '0'], ['500', '0', '75']], EntryType::Payment);
    Books::postJson($this->clerk, $this->company, 'journal-entries', $this->draft);
    $list = fn (string $query): array => collect(Books::as($this->clerk, $this->company)->getJson("/api/v1/journal-entries?{$query}")->assertOk()->json('data'))
        ->pluck('total_debit')->all();

    expect($list(''))->toBe(['250.5000', '75.0000', '500.0000', '10.0000'])
        ->and($list('filter[date_from]=2027-02-15&filter[date_to]=2027-04-30'))->toBe(['75.0000', '500.0000'])
        ->and($list('filter[status]=draft'))->toBe(['250.5000'])
        ->and($list('filter[entry_type]=payment'))->toBe(['75.0000'])
        ->and($list('filter[account_id]='.Books::account($this->company, '600')->id))->toBe(['500.0000', '10.0000'])
        ->and($list("filter[party_id]={$this->party}"))->toBe(['250.5000', '500.0000'])
        ->and($list('filter[amount_min]=50&filter[amount_max]=300'))->toBe(['250.5000', '75.0000'])
        ->and($list('q=2027000000002'))->toBe(['500.0000'])
        ->and($list('sort=total_debit'))->toBe(['10.0000', '75.0000', '250.5000', '500.0000']);

    Books::as($this->clerk, $this->company)->getJson('/api/v1/journal-entries?filter[date_from]=yesterday')->assertStatus(422);
    Books::as($this->clerk, $this->company)->getJson('/api/v1/journal-entries?filter[account_id]=nope')->assertStatus(422);
    Books::as($this->clerk, $this->company)->getJson('/api/v1/journal-entries?per_page=1')->assertOk()->assertJsonPath('meta.pagination.total', 4)
        ->assertJsonPath('data.0.line_count', 2);
});

it('exports lines as CSV with a formula guard and as XLSX', function (): void {
    Books::post($this->company, '2027-02-01', [['100', '10', '0', ['description' => '=HYPERLINK("x")']], ['600', '0', '10']]);

    $csv = Books::as($this->clerk, $this->company)->get('/api/v1/journal-entries/export?filter[status]=posted')->assertOk()->streamedContent();
    $rows = array_map('str_getcsv', array_filter(explode("\n", ltrim($csv, "\xEF\xBB\xBF"))));

    expect($rows[0][0])->toBe('number')
        ->and($rows)->toHaveCount(3)
        ->and($rows[1][6])->toBe('100')
        ->and($rows[1][16])->toBe("'=HYPERLINK(\"x\")");

    Books::as($this->clerk, $this->company)->get('/api/v1/journal-entries/export?format=xlsx')->assertOk()
        ->assertHeader('content-disposition');
    Books::as($this->clerk, $this->company)->getJson('/api/v1/journal-entries/export?filter[nope]=1')->assertStatus(422);

    config(['accounting.export_max_rows' => 1]);
    Books::as($this->clerk, $this->company)->getJson('/api/v1/journal-entries/export')->assertStatus(422);
});

it('keeps entries of other companies out of reach', function (): void {
    $other = Books::company();
    $foreign = Books::post($other, '2027-02-01', [['100', '10', '0'], ['600', '0', '10']]);
    $all = [...Books::ALL];

    $user = Actors::user($all, $this->company);
    Books::as($user, $this->company)->getJson("/api/v1/journal-entries/{$foreign->id}")->assertNotFound();
    Books::postJson($user, $this->company, "journal-entries/{$foreign->id}/reverse", ['date' => '2027-02-02', 'reason' => 'x'])->assertNotFound();
    Books::as($user, $this->company)->getJson('/api/v1/journal-entries')->assertOk()->assertJsonCount(0, 'data');

    // Lines may not point at accounts of the other company either.
    Books::postJson($user, $this->company, 'journal-entries', [...$this->draft, 'lines' => [['account_id' => Books::account($other, '100')->id, 'debit' => '1']]])
        ->assertStatus(422)->assertJsonValidationErrors(['lines.0.account_id'], 'errors.fields');
});
