<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Enums\ExpenseScheme;
use App\Modules\Accounting\Events\EntryPosted;
use App\Modules\Accounting\Exceptions\PeriodNotOpen;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Services\ChartSeeder;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Accounting\Services\FxRevaluation;
use App\Modules\Accounting\Services\JournalDrafts;
use App\Modules\Accounting\Services\LedgerPoster;
use App\Modules\Accounting\Services\PeriodStatusService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\Accounting\Books;
use Tests\Support\Companies;

/*
 * Committed data and two real connections (no wrapping test transaction): the deferred balance
 * check at a real COMMIT, row locks between posting and period close, and double-posting under
 * concurrency. Everything this file creates is removed in afterEach (triggers bypassed there only).
 */

beforeEach(function (): void {
    if (! Schema::hasTable('journal_entries')) {
        Artisan::call('migrate', ['--force' => true]);
    }

    Books::boot();
    config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);
    $this->a = DB::connection('pgsql');
    $this->b = DB::connection('pgsql_second');
    $this->company = Companies::make();
    app(CompanyContext::class)->set($this->company);
    app(ChartSeeder::class)->seed(ExpenseScheme::A);
    app(FiscalCalendar::class)->create(['code' => '2027', 'start_date' => '2027-01-01', 'end_date' => '2027-12-31']);
    $this->march = AccountingPeriod::query()->where('number', 3)->firstOrFail();
});

afterEach(function (): void {
    foreach ([$this->a, $this->b] as $connection) {
        while ($connection->transactionLevel() > 0) {
            $connection->rollBack();
        }
        $connection->statement('RESET lock_timeout');
    }

    // Booked rows are immutable by design; test cleanup alone switches the triggers off.
    $this->a->statement('SET session_replication_role = replica');
    foreach (['journal_lines', 'account_balances', 'journal_entries', 'account_determination_rules', 'accounts', 'accounting_periods', 'fiscal_years', 'number_sequences', 'activity_log'] as $table) {
        $this->a->table($table)->where('company_id', $this->company)->delete();
    }
    $this->a->statement('SET session_replication_role = DEFAULT');
    Companies::remove($this->company);
    app(CompanyContext::class)->clear();
    DB::purge('pgsql_second');
});

it('fails the COMMIT of an unbalanced posted entry and keeps nothing', function (): void {
    $id = (string) Str::uuid7();
    $cash = Books::account($this->company, '100')->id;
    $sales = Books::account($this->company, '600')->id;

    $this->b->beginTransaction();
    $this->b->table('journal_entries')->insert([
        'id' => $id, 'company_id' => $this->company, 'entry_type' => 'general', 'entry_date' => '2027-03-10', 'period_id' => $this->march->id,
        'fiscal_year_id' => $this->march->fiscal_year_id, 'status' => 'draft', 'version' => 1,
    ]);
    $this->b->table('journal_lines')->insert([
        ['id' => (string) Str::uuid7(), 'company_id' => $this->company, 'entry_id' => $id, 'line_no' => 1, 'account_id' => $cash, 'debit' => '10', 'credit' => '0'],
        ['id' => (string) Str::uuid7(), 'company_id' => $this->company, 'entry_id' => $id, 'line_no' => 2, 'account_id' => $sales, 'debit' => '0', 'credit' => '9'],
    ]);
    $this->b->table('journal_entries')->where('id', $id)->update(['status' => 'posted', 'number' => 'C-1', 'total_debit' => '10', 'total_credit' => '9']);

    try {
        $this->b->commit();
        $this->fail('The commit should have failed.');
    } catch (PDOException $e) {
        // A failing COMMIT surfaces as the driver exception itself.
        expect($e->errorInfo[0] ?? null)->toBe('KA001');
    }

    while ($this->b->transactionLevel() > 0) {
        $this->b->rollBack();
    }

    expect($this->a->table('journal_entries')->where('id', $id)->exists())->toBeFalse();
});

it('makes a posting wait for a concurrent period close and then refuses it', function (): void {
    $this->b->beginTransaction();
    $this->b->table('accounting_periods')->where('id', $this->march->id)->update(['status' => 'closed', 'version' => 2]);

    $this->a->statement("SET lock_timeout = '300ms'");
    expect(fn () => Books::post($this->company, '2027-03-10', [['100', '5', '0'], ['600', '0', '5']]))
        ->toThrow(QueryException::class, 'lock timeout');

    $this->b->commit();
    expect(fn () => Books::post($this->company, '2027-03-10', [['100', '5', '0'], ['600', '0', '5']]))->toThrow(PeriodNotOpen::class);
    expect(JournalEntry::query()->count())->toBe(0);
});

it('makes a period close wait for an open posting transaction', function (): void {
    $this->a->beginTransaction();
    $entry = Books::post($this->company, '2027-03-10', [['100', '5', '0'], ['600', '0', '5']]);

    $this->b->statement("SET lock_timeout = '300ms'");
    expect(fn () => $this->b->table('accounting_periods')->where('id', $this->march->id)->update(['status' => 'closed']))
        ->toThrow(QueryException::class, 'lock timeout');

    $this->a->commit();
    $closed = app(PeriodStatusService::class)->close($this->march, null);

    expect($closed->status->value)->toBe('closed')
        ->and(JournalEntry::query()->findOrFail($entry->id)->status->value)->toBe('posted');
});

it('books a source document once even when two connections race', function (): void {
    $source = (string) Str::uuid7();
    $key = "sales_invoice|{$source}|main";

    $this->a->beginTransaction();
    $first = Books::post($this->company, '2027-03-10', [['100', '5', '0'], ['600', '0', '5']], source: 'sales_invoice', sourceId: $source);

    // The second poster serializes on the posting-key lock...
    $this->b->statement("SET lock_timeout = '300ms'");
    expect(fn () => $this->b->select('select pg_advisory_xact_lock(hashtext(?))', ['accounting.post.'.hash('sha256', $key).'.'.$this->company]))
        ->toThrow(QueryException::class, 'lock timeout');
    // ...and a writer that skips the lock still hits the unique booked-key index.
    expect(fn () => $this->b->table('journal_entries')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $this->company, 'entry_type' => 'general', 'entry_date' => '2027-03-10',
        'period_id' => $this->march->id, 'fiscal_year_id' => $this->march->fiscal_year_id, 'status' => 'posted', 'number' => 'X-1',
        'posting_key' => $key, 'total_debit' => '5', 'total_credit' => '5', 'version' => 1,
    ]))->toThrow(QueryException::class, 'lock timeout');

    $this->a->commit();
    $second = Books::post($this->company, '2027-03-10', [['100', '5', '0'], ['600', '0', '5']], source: 'sales_invoice', sourceId: $source);

    expect($second->id)->toBe($first->id)->and($second->replayed)->toBeTrue()
        ->and(JournalEntry::query()->where('posting_key', $key)->count())->toBe(1);
});

it('returns the number of a rolled back posting and announces only committed ones', function (): void {
    $numbers = [];
    Event::listen(EntryPosted::class, function (EntryPosted $e) use (&$numbers): void {
        $numbers[] = $e->number;
    });

    try {
        DB::transaction(function (): void {
            expect(Books::post($this->company, '2027-03-10', [['100', '5', '0'], ['600', '0', '5']])->number)->toBe('2027000000001');

            throw new RuntimeException('abort');
        });
    } catch (RuntimeException) {
    }

    expect($numbers)->toBe([]);
    $entry = Books::post($this->company, '2027-03-11', [['100', '7', '0'], ['600', '0', '7']]);

    expect($entry->number)->toBe('2027000000001')->and($numbers)->toBe(['2027000000001']);
    [$stored, $computed] = Books::balanceSnapshots($this->company);
    expect($stored)->toEqual($computed);
});

it('makes posting a draft wait for a concurrent change of its account to non-postable and then refuses it', function (): void {
    $draft = app(JournalDrafts::class)->create([
        'entry_type' => 'general', 'entry_date' => '2027-03-10',
        'lines' => [['account_code' => '100', 'debit' => '5'], ['account_code' => '600', 'credit' => '5']],
    ], null);
    $sales = Books::account($this->company, '600')->id;

    $this->b->beginTransaction();
    $this->b->table('accounts')->where('id', $sales)->update(['is_postable' => false]);

    $this->a->statement("SET lock_timeout = '300ms'");
    expect(fn () => app(LedgerPoster::class)->postDraft($draft, null, false))->toThrow(QueryException::class, 'lock timeout');

    $this->b->commit();
    expect(fn () => app(LedgerPoster::class)->postDraft($draft, null, false))->toThrow(Exception::class);
    expect(JournalEntry::query()->findOrFail($draft->id)->status->value)->toBe('draft');
});

it('makes draft creation wait for a concurrent period close and then refuses it', function (): void {
    $create = fn () => app(JournalDrafts::class)->create([
        'entry_type' => 'general', 'entry_date' => '2027-03-10', 'lines' => [['account_code' => '100', 'debit' => '5']],
    ], null);

    $this->b->beginTransaction();
    $this->b->table('accounting_periods')->where('id', $this->march->id)->update(['status' => 'closed', 'version' => 2]);

    $this->a->statement("SET lock_timeout = '300ms'");
    expect($create)->toThrow(QueryException::class, 'lock timeout');

    $this->b->commit();
    expect($create)->toThrow(ValidationException::class);
    expect(JournalEntry::query()->count())->toBe(0);
});

it('serializes FX revaluations per period whatever the rate date, and against postings into the period', function (): void {
    $run = fn (string $rateDate) => app(FxRevaluation::class)->run($this->march, new DateTimeImmutable($rateDate), false, null);
    $this->a->statement("SET lock_timeout = '300ms'");

    // Another run of the same period (any rate date) holds the period's revaluation lock.
    $this->b->beginTransaction();
    $this->b->select('select pg_advisory_xact_lock(hashtext(?))', ['accounting.fx.'.$this->march->id.'.'.$this->company]);
    expect(fn () => $run('2027-03-31'))->toThrow(QueryException::class, 'lock timeout');
    $this->b->rollBack();

    // An ordinary posting into the period holds its share lock.
    $this->b->beginTransaction();
    $this->b->select('select id from accounting_periods where id = ? for share', [$this->march->id]);
    expect(fn () => $run('2027-03-30'))->toThrow(QueryException::class, 'lock timeout');
    $this->b->rollBack();

    expect(JournalEntry::query()->count())->toBe(0);
});
