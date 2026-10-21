<?php

declare(strict_types=1);

use App\Modules\Accounting\Contracts\PostingService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Accounting\Books;

/*
 * Raw SQL against the database invariants, bypassing every service. Each attempt runs in a
 * savepoint so the wrapping test transaction survives the error; deferred checks are forced
 * with SET CONSTRAINTS ... IMMEDIATE because the test transaction never commits (a real COMMIT
 * is covered in LedgerCommittedTest).
 */

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->march = Books::period($this->company, '2027', 3);
    $this->cash = Books::account($this->company, '100')->id;
    $this->sales = Books::account($this->company, '600')->id;
});

/** Expects $fn (run in a savepoint) to fail with $state. */
function violates(string $state, Closure $fn): void
{
    try {
        DB::transaction(function () use ($fn): void {
            $fn();
            DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
        });
        test()->fail("Expected SQLSTATE {$state}.");
    } catch (QueryException $e) {
        expect($e->errorInfo[0] ?? null)->toBe($state, $e->getMessage());
    } finally {
        DB::statement('SET CONSTRAINTS ALL DEFERRED');
    }
}

function rawEntry(string $company, object $period, array $attributes = []): string
{
    $id = (string) Str::uuid7();
    DB::table('journal_entries')->insert([
        'id' => $id, 'company_id' => $company, 'entry_type' => 'general', 'entry_date' => '2027-03-10',
        'period_id' => $period->id, 'fiscal_year_id' => $period->fiscal_year_id, 'status' => 'draft',
        'total_debit' => '0', 'total_credit' => '0', 'version' => 1, 'created_at' => now(), 'updated_at' => now(),
        ...$attributes,
    ]);

    return $id;
}

function rawLine(string $company, string $entry, string $account, string $debit, string $credit, int $no = 1): string
{
    $id = (string) Str::uuid7();
    DB::table('journal_lines')->insert([
        'id' => $id, 'company_id' => $company, 'entry_id' => $entry, 'line_no' => $no, 'account_id' => $account, 'debit' => $debit, 'credit' => $credit,
    ]);

    return $id;
}

function rawPost(string $entry, string $debit, string $credit, string $number = 'RAW-1'): void
{
    DB::table('journal_entries')->where('id', $entry)->update(['status' => 'posted', 'number' => $number, 'total_debit' => $debit, 'total_credit' => $credit]);
}

it('rejects a posted entry whose lines do not balance (deferred constraint trigger)', function (): void {
    violates('KA001', function (): void {
        $entry = rawEntry($this->company, $this->march);
        rawLine($this->company, $entry, $this->cash, '100', '0', 1);
        rawLine($this->company, $entry, $this->sales, '0', '99', 2);
        rawPost($entry, '100', '99');
    });
});

it('rejects a posted entry whose totals differ from its lines and an empty posted entry', function (): void {
    violates('KA001', function (): void {
        $entry = rawEntry($this->company, $this->march);
        rawLine($this->company, $entry, $this->cash, '100', '0', 1);
        rawLine($this->company, $entry, $this->sales, '0', '100', 2);
        rawPost($entry, '90', '90');
    });

    violates('KA001', function (): void {
        rawEntry($this->company, $this->march, ['status' => 'posted', 'number' => 'RAW-EMPTY']);
    });
});

it('accepts a balanced raw posting', function (): void {
    DB::transaction(function (): void {
        $entry = rawEntry($this->company, $this->march);
        rawLine($this->company, $entry, $this->cash, '100', '0', 1);
        rawLine($this->company, $entry, $this->sales, '0', '100', 2);
        rawPost($entry, '100', '100');
        DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
    });
    DB::statement('SET CONSTRAINTS ALL DEFERRED');

    expect(DB::table('journal_entries')->where('number', 'RAW-1')->value('status'))->toBe('posted');
});

it('keeps lines amounts sane through check constraints', function (): void {
    $entry = rawEntry($this->company, $this->march);

    violates('23514', fn () => rawLine($this->company, $entry, $this->cash, '10', '10'));
    violates('23514', fn () => rawLine($this->company, $entry, $this->cash, '0', '0'));
    violates('23514', fn () => rawLine($this->company, $entry, $this->cash, '-5', '0'));
});

it('makes booked entries and their lines immutable', function (): void {
    $posted = Books::post($this->company, '2027-03-10', [['100', '100', '0'], ['600', '0', '100']]);
    $line = DB::table('journal_lines')->where('entry_id', $posted->id)->orderBy('line_no')->value('id');

    violates('KA002', fn () => DB::table('journal_lines')->where('id', $line)->update(['debit' => '200']));
    violates('KA002', fn () => DB::table('journal_lines')->where('id', $line)->delete());
    violates('KA002', fn () => rawLine($this->company, $posted->id, $this->cash, '1', '0', 9));
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->update(['description' => 'changed']));
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->update(['entry_date' => '2027-03-11']));
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->update(['status' => 'draft', 'number' => null]));
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->delete());
    // The reversed transition needs a real reversing entry and a version bump.
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->update(['status' => 'reversed', 'reversed_by_id' => $posted->id, 'version' => 3]));
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->update(['status' => 'reversed']));

    $draft = rawEntry($this->company, $this->march);
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $draft)->update(['status' => 'reversed']));

    expect(DB::table('journal_entries')->where('id', $posted->id)->value('description'))->toBe('Test entry');
});

it('allows only the controlled posted to reversed transition and freezes reversed entries', function (): void {
    $posted = Books::post($this->company, '2027-03-10', [['100', '100', '0'], ['600', '0', '100']]);
    $reversal = Books::in($this->company, fn () => app(PostingService::class)->reverse($posted->id, new DateTimeImmutable('2027-03-12'), 'test'));

    expect(DB::table('journal_entries')->where('id', $posted->id)->value('status'))->toBe('reversed')
        ->and(DB::table('journal_entries')->where('id', $posted->id)->value('reversed_by_id'))->toBe($reversal->id);

    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->update(['status' => 'posted', 'version' => DB::raw('version + 1')]));
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $posted->id)->update(['reversal_reason' => 'x']));
    violates('KA002', fn () => DB::table('journal_entries')->where('id', $reversal->id)->delete());
});

it('refuses postings into closed or soft-closed periods and closed years', function (): void {
    $book = function (): string {
        $entry = rawEntry($this->company, $this->march);
        rawLine($this->company, $entry, $this->cash, '5', '0', 1);
        rawLine($this->company, $entry, $this->sales, '0', '5', 2);

        return $entry;
    };

    DB::table('accounting_periods')->where('id', $this->march->id)->update(['status' => 'closed']);
    violates('KA003', fn () => rawPost($book(), '5', '5'));

    DB::table('accounting_periods')->where('id', $this->march->id)->update(['status' => 'soft_closed']);
    violates('KA003', fn () => rawPost($book(), '5', '5'));

    DB::transaction(function () use ($book): void {
        DB::select("select set_config('keystone.allow_soft_closed', 'on', true)");
        rawPost($book(), '5', '5', 'RAW-SOFT');
        DB::select("select set_config('keystone.allow_soft_closed', 'off', true)");
    });
    expect(DB::table('journal_entries')->where('number', 'RAW-SOFT')->exists())->toBeTrue();

    DB::table('accounting_periods')->where('id', $this->march->id)->update(['status' => 'open']);
    DB::table('fiscal_years')->where('id', $this->march->fiscal_year_id)->update(['status' => 'closed']);
    violates('KA003', fn () => rawPost($book(), '5', '5', 'RAW-2'));
    // Inserting straight as posted is guarded the same way.
    violates('KA003', fn () => rawEntry($this->company, $this->march, ['status' => 'posted', 'number' => 'RAW-3']));
});

it('keeps the entry date inside its period of the same company and year', function (): void {
    violates('KA005', fn () => rawEntry($this->company, $this->march, ['entry_date' => '2027-04-01']));
    violates('KA005', fn () => DB::table('journal_entries')->where('id', rawEntry($this->company, $this->march))->update(['entry_date' => '2027-02-28']));

    $other = Books::company();
    $foreignPeriod = Books::period($other, '2027', 3);
    violates('KA005', fn () => rawEntry($this->company, $foreignPeriod));
    violates('KA005', fn () => rawEntry($this->company, $this->march, ['fiscal_year_id' => $foreignPeriod->fiscal_year_id]));
});

it('only lets postable accounts of the company into lines', function (): void {
    $entry = rawEntry($this->company, $this->march);
    $heading = Books::account($this->company, '10')->id;
    $foreign = Books::account(Books::company(), '100')->id;

    violates('KA004', fn () => rawLine($this->company, $entry, $heading, '1', '0'));
    violates('KA004', fn () => rawLine($this->company, $entry, $foreign, '1', '0'));

    // A draft line whose account later became a heading cannot be posted.
    rawLine($this->company, $entry, $this->cash, '5', '0', 1);
    rawLine($this->company, $entry, $this->sales, '0', '5', 2);
    DB::table('accounts')->where('id', $this->cash)->update(['is_postable' => false]);
    violates('KA004', fn () => rawPost($entry, '5', '5'));
});

it('protects accounts used in booked lines', function (): void {
    Books::post($this->company, '2027-03-10', [['100', '100', '0'], ['600', '0', '100']]);

    violates('KA004', fn () => DB::table('accounts')->where('id', $this->cash)->update(['is_postable' => false]));
    violates('KA004', fn () => DB::table('accounts')->where('id', $this->cash)->delete());

    // Renaming or deactivating stays possible.
    DB::table('accounts')->where('id', $this->cash)->update(['name' => 'Merkez kasa', 'is_active' => false]);
    expect(DB::table('accounts')->where('id', $this->cash)->value('name'))->toBe('Merkez kasa');
});

it('enforces the account tree: postable parents, cycles and companies', function (): void {
    $cashGroup = Books::account($this->company, '10')->id;
    $current = Books::account($this->company, '1')->id;
    $insert = fn (string $code, ?string $parent, bool $postable = true, ?string $company = null) => DB::table('accounts')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $company ?? $this->company, 'code' => $code, 'name' => $code, 'parent_id' => $parent,
        'level' => 4, 'type' => 'asset', 'normal_balance' => 'debit', 'is_postable' => $postable,
    ]);

    violates('KA006', fn () => $insert('100.01', $this->cash));
    violates('KA006', fn () => $insert('X1', $cashGroup, true, Books::company()));
    violates('KA006', fn () => DB::table('accounts')->where('id', $current)->update(['parent_id' => $cashGroup]));
    violates('KA006', fn () => DB::table('accounts')->where('id', $current)->update(['parent_id' => $current]));
    violates('KA006', fn () => DB::table('accounts')->where('id', $cashGroup)->update(['is_postable' => true]));
    violates('KA006', fn () => DB::table('accounts')->where('id', $cashGroup)->update(['company_id' => Books::company()]));
});

it('keeps fiscal years and periods free of overlaps and gaps', function (): void {
    $year = Books::fiscalYear($this->company, '2027');

    violates('23P01', fn () => DB::table('fiscal_years')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $this->company, 'code' => 'X', 'name' => 'X', 'start_date' => '2027-12-01', 'end_date' => '2028-11-30',
    ]));
    violates('23P01', fn () => DB::table('accounting_periods')->where('fiscal_year_id', $year->id)->where('number', 4)->update(['start_date' => '2027-03-31']));
    violates('KA007', fn () => DB::table('accounting_periods')->where('fiscal_year_id', $year->id)->where('number', 4)->update(['start_date' => '2027-04-02']));
    violates('KA007', fn () => DB::table('accounting_periods')->where('fiscal_year_id', $year->id)->where('number', 12)->delete());
    violates('KA007', fn () => DB::table('accounting_periods')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $this->company, 'fiscal_year_id' => $year->id, 'number' => 13, 'start_date' => '2027-12-30', 'end_date' => '2027-12-31',
    ]));
    violates('KA007', fn () => DB::table('fiscal_years')->where('id', $year->id)->update(['end_date' => '2028-01-31']));

    // Another company may use the same dates; the zero-length period 13 is allowed on the last day.
    Books::company();
    DB::transaction(function () use ($year): void {
        DB::table('accounting_periods')->insert([
            'id' => (string) Str::uuid7(), 'company_id' => $this->company, 'fiscal_year_id' => $year->id, 'number' => 13, 'start_date' => '2027-12-31', 'end_date' => '2027-12-31',
        ]);
        DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
    });
    DB::statement('SET CONSTRAINTS ALL DEFERRED');
    expect(DB::table('accounting_periods')->where('fiscal_year_id', $year->id)->count())->toBe(13);
});
