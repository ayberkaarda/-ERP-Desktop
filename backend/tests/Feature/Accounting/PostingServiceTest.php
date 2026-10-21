<?php

declare(strict_types=1);

use App\Modules\Accounting\Contracts\AccountLookup;
use App\Modules\Accounting\Contracts\PeriodGuard;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Enums\PeriodStatus;
use App\Modules\Accounting\Events\EntryPosted;
use App\Modules\Accounting\Events\EntryReversed;
use App\Modules\Accounting\Exceptions\PeriodNotOpen;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Models\JournalLine;
use App\Modules\Accounting\Services\ChartOfAccounts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\Accounting\Books;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->party = Books::$parties[0];
});

it('books a balanced entry with a gapless number per fiscal year and maintains balances', function (): void {
    $first = Books::post($this->company, '2027-03-10', [['100', '1000.00', '0'], ['500', '0', '1000.00']], EntryType::Opening);
    $second = Books::post($this->company, '2027-03-11', [
        ['120', '1180.00', '0', ['partyId' => $this->party]],
        ['600', '0', '1000.00'],
        ['391', '0', '180.00'],
    ]);

    expect($first->number)->toBe('2027-000001')
        ->and($second->number)->toBe('2027-000002')
        ->and($second->status)->toBe('posted')
        ->and($second->totalDebit)->toBe('1180.0000')
        ->and($second->totalCredit)->toBe('1180.0000')
        ->and(Books::balance($this->company, '120'))->toBe('1180.0000')
        ->and(Books::balance($this->company, '600'))->toBe('-1000.0000');

    [$stored, $computed] = Books::balanceSnapshots($this->company);
    expect($stored)->toHaveCount(5)->and($stored)->toEqual($computed);

    $period = Books::period($this->company, '2027', 3);
    expect(DB::table('account_balances')->where('account_id', Books::account($this->company, '100')->id)->where('period_id', $period->id)->value('debit_total'))
        ->toBe('1000.0000');
});

it('is idempotent per source and purpose and never books a key twice', function (): void {
    $source = (string) Str::uuid7();
    $a = Books::post($this->company, '2027-04-01', [['100', '50', '0'], ['600', '0', '50']], source: 'sales_invoice', sourceId: $source);
    $b = Books::post($this->company, '2027-04-01', [['100', '50', '0'], ['600', '0', '50']], source: 'sales_invoice', sourceId: $source);
    $cogs = Books::post($this->company, '2027-04-01', [['621', '30', '0'], ['153', '0', '30']], source: 'sales_invoice', sourceId: $source, purpose: 'cogs');

    expect($b->id)->toBe($a->id)->and($b->replayed)->toBeTrue()->and($a->replayed)->toBeFalse()
        ->and($cogs->id)->not->toBe($a->id)
        ->and(Books::in($this->company, fn () => JournalEntry::query()->count()))->toBe(2)
        ->and(Books::balance($this->company, '100'))->toBe('50.0000');
});

it('dispatches EntryPosted and EntryReversed only after commit with ids', function (): void {
    Event::fake([EntryPosted::class, EntryReversed::class]);

    DB::transaction(function (): void {
        Books::post($this->company, '2027-04-02', [['100', '10', '0'], ['600', '0', '10']]);
        Event::assertNotDispatched(EntryPosted::class);
    });

    Event::assertDispatched(EntryPosted::class, fn (EntryPosted $e): bool => $e->companyId === $this->company && $e->number === '2027-000001');
    $entry = Books::in($this->company, fn () => JournalEntry::query()->firstOrFail());

    Books::in($this->company, fn () => app(PostingService::class)->reverse($entry->id, new DateTimeImmutable('2027-04-03'), 'wrong amount'));
    Event::assertDispatched(EntryReversed::class, fn (EntryReversed $e): bool => $e->entryId === $entry->id);
});

it('reverses an entry with mirrored lines linked both ways', function (): void {
    $entry = Books::post($this->company, '2027-05-05', [['120', '118', '0', ['partyId' => $this->party]], ['600', '0', '100'], ['391', '0', '18']]);
    $reversal = Books::in($this->company, fn () => app(PostingService::class)->reverse($entry->id, new DateTimeImmutable('2027-05-06'), 'customer cancelled'));

    $original = Books::in($this->company, fn () => JournalEntry::query()->findOrFail($entry->id));
    $mirror = Books::in($this->company, fn () => JournalEntry::query()->with('lines')->findOrFail($reversal->id));

    expect($original->status->value)->toBe('reversed')
        ->and($original->reversed_by_id)->toBe($reversal->id)
        ->and($mirror->reverses_id)->toBe($entry->id)
        ->and($mirror->entry_type->value)->toBe('reversal')
        ->and($mirror->reversal_reason)->toBe('customer cancelled')
        ->and($mirror->number)->toBe('2027-000002')
        ->and((string) $mirror->lines[0]->credit)->toBe('118.0000')
        ->and($mirror->lines[0]->party_id)->toBe($this->party)
        ->and(Books::balance($this->company, '120'))->toBe('0.0000');

    expect(fn () => Books::in($this->company, fn () => app(PostingService::class)->reverse($entry->id, new DateTimeImmutable('2027-05-06'), 'again')))
        ->toThrow(ValidationException::class);
    expect(fn () => Books::in($this->company, fn () => app(PostingService::class)->reverse($entry->id, new DateTimeImmutable('2027-05-06'), ' ')))
        ->toThrow(ValidationException::class);
});

it('rejects unbalanced, empty, one-sided and malformed requests', function (array $lines, string $field): void {
    try {
        Books::post($this->company, '2027-05-05', $lines);
        $this->fail('Expected a validation error.');
    } catch (ValidationException $e) {
        expect($e->errors())->toHaveKey($field);
    }

    expect(Books::in($this->company, fn () => JournalEntry::query()->count()))->toBe(0);
})->with([
    'unbalanced' => [[['100', '10', '0'], ['600', '0', '9.99']], 'lines'],
    'five decimals' => [[['100', '10.00001', '0'], ['600', '0', '10.00001']], 'lines.0.debit'],
    'negative' => [[['100', '-10', '0'], ['600', '0', '-10']], 'lines.0.debit'],
    'unknown account' => [[['999', '10', '0'], ['600', '0', '10']], 'lines.0.account_id'],
    'heading account' => [[['10', '10', '0'], ['600', '0', '10']], 'lines.0.account_id'],
    'missing party' => [[['120', '10', '0'], ['600', '0', '10']], 'lines.0.party_id'],
    'unknown party' => [[['120', '10', '0', ['partyId' => '01900000-0000-7000-8000-000000000000']], ['600', '0', '10']], 'lines.0.party_id'],
]);

it('rejects both sides on one line and a line without amount', function (): void {
    $request = fn (array $lines) => new PostingRequest($this->company, new DateTimeImmutable('2027-05-05'), EntryType::General, null, null, null, $lines);

    expect(fn () => app(PostingService::class)->post($request([new PostingLine(accountCode: '100', debit: '5', credit: '5'), PostingLine::credit('600', '0')])))
        ->toThrow(ValidationException::class);
    expect(fn () => app(PostingService::class)->post($request([])))->toThrow(ValidationException::class);
});

it('caps an entry at 500 lines', function (): void {
    $lines = array_fill(0, 501, PostingLine::debit('100', '1'));

    expect(fn () => app(PostingService::class)->post(new PostingRequest($this->company, new DateTimeImmutable('2027-05-05'), EntryType::General, null, null, null, $lines)))
        ->toThrow(ValidationException::class);
});

it('requires dimensions and foreign currency data the account asks for', function (): void {
    Books::in($this->company, function (): void {
        $bank = Books::account($this->company, '102');
        $bank->forceFill(['is_postable' => false])->save();
    });
    $usd = Books::in($this->company, fn () => app(ChartOfAccounts::class)->create([
        'code' => '102.01', 'name' => 'USD bank', 'parent_code' => '102', 'currency_code' => 'USD', 'requires_cost_center' => true, 'requires_project' => true,
    ]));

    try {
        Books::post($this->company, '2027-05-05', [['102.01', '100', '0'], ['600', '0', '100']]);
        $this->fail('Expected validation errors.');
    } catch (ValidationException $e) {
        expect($e->errors())->toHaveKeys(['lines.0.cost_center_id', 'lines.0.project_id', 'lines.0.fx_amount']);
    }

    $entry = Books::post($this->company, '2027-05-05', [
        ['102.01', '3500', '0', ['currency' => 'USD', 'fxAmount' => '100', 'fxRate' => '35', 'costCenterId' => Books::$costCenters[0], 'projectId' => Books::$projects[0]]],
        ['600', '0', '3500'],
    ]);
    expect($entry->status)->toBe('posted')->and($usd->level)->toBe(4);

    expect(fn () => Books::post($this->company, '2027-05-05', [
        ['102.01', '3500', '0', ['currency' => 'EUR', 'fxAmount' => '100', 'costCenterId' => Books::$costCenters[0], 'projectId' => Books::$projects[0]]],
        ['600', '0', '3500'],
    ]))->toThrow(ValidationException::class);
});

it('refuses closed and soft-closed periods unless the caller allows soft-closed', function (): void {
    $march = Books::period($this->company, '2027', 3);
    $march->forceFill(['status' => PeriodStatus::SoftClosed])->save();

    expect(fn () => Books::post($this->company, '2027-03-05', [['100', '1', '0'], ['600', '0', '1']]))->toThrow(PeriodNotOpen::class);
    expect(Books::post($this->company, '2027-03-05', [['100', '1', '0'], ['600', '0', '1']], allowSoftClosed: true)->status)->toBe('posted');

    $march->refresh()->forceFill(['status' => PeriodStatus::Closed])->save();
    expect(fn () => Books::post($this->company, '2027-03-05', [['100', '1', '0'], ['600', '0', '1']], allowSoftClosed: true))->toThrow(PeriodNotOpen::class);
    expect(fn () => Books::post($this->company, '2031-01-05', [['100', '1', '0'], ['600', '0', '1']]))->toThrow(PeriodNotOpen::class);

    expect(fn () => app(PeriodGuard::class)->assertOpen($this->company, new DateTimeImmutable('2027-03-31')))->toThrow(PeriodNotOpen::class);
    app(PeriodGuard::class)->assertOpen($this->company, new DateTimeImmutable('2027-04-01'));
});

it('exposes accounts of the active company through AccountLookup only', function (): void {
    $other = Books::company();
    $kasa = Books::account($this->company, '100');

    $found = Books::in($this->company, fn () => app(AccountLookup::class)->findByCode('100'));
    expect($found?->id)->toBe($kasa->id)->and($found?->isPostable)->toBeTrue()->and($found?->normalBalance)->toBe('debit');
    expect(Books::in($other, fn () => app(AccountLookup::class)->find($kasa->id)))->toBeNull();
    expect(Books::in($this->company, fn () => app(AccountLookup::class)->find('not-a-uuid')))->toBeNull();
});

it('keeps companies apart: an account id of another company cannot be booked', function (): void {
    $other = Books::company();
    $foreign = Books::account($other, '100');

    expect(fn () => app(PostingService::class)->post(new PostingRequest($this->company, new DateTimeImmutable('2027-05-05'), EntryType::General, null, null, null, [
        PostingLine::debit($foreign->id, '5'), PostingLine::credit('600', '5'),
    ])))->toThrow(ValidationException::class);
});

it('books 500 lines in one entry quickly', function (): void {
    $lines = [];

    for ($i = 0; $i < 250; $i++) {
        $lines[] = PostingLine::debit('100', '12.3456');
        $lines[] = PostingLine::credit('600', '12.3456');
    }

    $started = microtime(true);
    $entry = app(PostingService::class)->post(new PostingRequest($this->company, new DateTimeImmutable('2027-05-05'), EntryType::General, 'bulk', null, null, $lines));
    $elapsed = microtime(true) - $started;

    expect($entry->totalDebit)->toBe('3086.4000')
        ->and(Books::in($this->company, fn () => JournalLine::query()->where('entry_id', $entry->id)->count()))->toBe(500)
        ->and($elapsed)->toBeLessThan(5.0);
});
