<?php

declare(strict_types=1);

use App\Modules\Organization\Services\MasterDataIntegrity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Accounting\Books;

uses(RefreshDatabase::class);

const ACCOUNTING_FK_MIGRATION = 'database/migrations/2027_01_01_900100_add_accounting_foreign_keys.php';

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
});

/** Foreign keys of the schema as "table.column" => "referenced table:delete rule:update rule". */
function accountingForeignKeys(): array
{
    return collect(DB::select(<<<'SQL'
        SELECT tc.table_name AS tab, kcu.column_name AS col, ccu.table_name AS ref, rc.delete_rule AS del, rc.update_rule AS upd
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
        SQL))->mapWithKeys(fn (object $k): array => ["{$k->tab}.{$k->col}" => "{$k->ref}:{$k->del}:{$k->upd}"])->all();
}

/** A draft entry with one raw line (drafts are mutable, so the ledger triggers allow it). */
function draftLineWith(string $company, array $line): string
{
    $period = Books::period($company, '2027', 3);
    $entry = (string) Str::uuid7();
    DB::table('journal_entries')->insert([
        'id' => $entry, 'company_id' => $company, 'entry_type' => 'general', 'entry_date' => '2027-03-05', 'period_id' => $period->id,
        'fiscal_year_id' => $period->fiscal_year_id, 'status' => 'draft', 'version' => 1, 'created_at' => now(), 'updated_at' => now(),
    ]);
    DB::table('journal_lines')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $company, 'entry_id' => $entry, 'line_no' => 1,
        'account_id' => Books::account($company, '120')->id, 'debit' => '10', 'credit' => '0', ...$line,
    ]);

    return $entry;
}

it('constrains every accounting table to companies and its cross-module references with RESTRICT', function (): void {
    $keys = accountingForeignKeys();

    foreach (MasterDataIntegrity::ACCOUNTING_COMPANY_TABLES as $table) {
        expect($keys["{$table}.company_id"] ?? null)->toBe('companies:RESTRICT:RESTRICT');
    }
    expect(array_intersect_key($keys, array_flip([
        'accounts.currency_code', 'journal_lines.currency_code', 'journal_lines.party_id', 'journal_lines.cost_center_id',
        'journal_lines.project_id', 'fiscal_years.closed_by', 'accounting_periods.closed_by', 'journal_entries.posted_by',
        'journal_entries.created_by',
    ])))->toEqual([
        'accounts.currency_code' => 'currencies:RESTRICT:RESTRICT',
        'journal_lines.currency_code' => 'currencies:RESTRICT:RESTRICT',
        'journal_lines.party_id' => 'parties:RESTRICT:RESTRICT',
        'journal_lines.cost_center_id' => 'cost_centers:RESTRICT:RESTRICT',
        'journal_lines.project_id' => 'projects:RESTRICT:RESTRICT',
        'fiscal_years.closed_by' => 'users:RESTRICT:RESTRICT',
        'accounting_periods.closed_by' => 'users:RESTRICT:RESTRICT',
        'journal_entries.posted_by' => 'users:RESTRICT:RESTRICT',
        'journal_entries.created_by' => 'users:RESTRICT:RESTRICT',
    ])
        // Same-module keys from the Accounting migrations are still in place.
        ->and($keys['journal_lines.account_id'])->toBe('accounts:RESTRICT:NO ACTION')
        ->and($keys['journal_entries.period_id'])->toBe('accounting_periods:RESTRICT:NO ACTION');
});

it('rejects lines pointing at parties, cost centers, projects or currencies that do not exist', function (string $column, string $value): void {
    expect(fn () => DB::transaction(fn () => draftLineWith($this->company, [$column => $value])))
        ->toThrow(QueryException::class, 'journal_lines_'.$column.'_foreign');
})->with([
    'party' => ['party_id', '0190a1b2-0000-7000-8000-000000000001'],
    'cost center' => ['cost_center_id', '0190a1b2-0000-7000-8000-000000000002'],
    'project' => ['project_id', '0190a1b2-0000-7000-8000-000000000003'],
    'currency' => ['currency_code', 'XAU'],
]);

it('refuses the hard delete of a party a posted line uses and keeps the posted entry unchanged', function (): void {
    $party = Books::$parties[0];
    $posted = Books::post($this->company, '2027-03-10', [['120', '100.00', '0', ['partyId' => $party]], ['600', '0', '100.00']]);

    expect(fn () => DB::transaction(fn () => DB::table('parties')->where('id', $party)->delete()))
        ->toThrow(QueryException::class, 'journal_lines_party_id_foreign');
    // The ledger invariant still wins over any attempt to detach the party from a posted line.
    expect(fn () => DB::transaction(fn () => DB::table('journal_lines')->where('entry_id', $posted->id)->update(['party_id' => null])))
        ->toThrow(QueryException::class);

    expect(DB::table('journal_lines')->where('entry_id', $posted->id)->where('party_id', $party)->count())->toBe(1)
        ->and(DB::table('parties')->where('id', $party)->exists())->toBeTrue();
});

it('refuses to add the keys over orphan accounting rows with counts and validates them once fixed', function (): void {
    /** @var Migration $migration */
    $migration = require base_path(ACCOUNTING_FK_MIGRATION);
    $migration->down();
    expect(array_key_exists('journal_lines.party_id', accountingForeignKeys()))->toBeFalse();

    $entry = draftLineWith($this->company, ['party_id' => (string) Str::uuid7()]);
    // ALTER TABLE needs the deferred ledger checks of this test transaction to have run.
    DB::statement('SET CONSTRAINTS ALL IMMEDIATE');

    try {
        $migration->up();
        $this->fail('The migration must refuse orphan rows.');
    } catch (RuntimeException $e) {
        expect($e->getMessage())->toContain('journal_lines.party_id: 1')->toContain('Accounting rows are never changed automatically');
    }
    expect(array_key_exists('journal_lines.party_id', accountingForeignKeys()))->toBeFalse()
        ->and(DB::table('journal_lines')->where('entry_id', $entry)->whereNotNull('party_id')->count())->toBe(1);

    DB::table('journal_entries')->where('id', $entry)->delete();
    DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
    $migration->up();

    $state = DB::selectOne("SELECT convalidated FROM pg_constraint WHERE conname = 'journal_lines_party_id_foreign'");
    expect($state?->convalidated)->toBeTrue()
        ->and(accountingForeignKeys()['journal_lines.company_id'])->toBe('companies:RESTRICT:RESTRICT');
});

it('reports journal lines whose party belongs to another company in the tenancy audit', function (): void {
    // Books parties belong to a separate owner company, so a line of this company using one crosses tenants.
    draftLineWith($this->company, ['party_id' => Books::$parties[0]]);

    expect((new MasterDataIntegrity(DB::connection()))->tenancyViolations())->toBe(['journal_lines.party_id' => 1])
        ->and(Artisan::call('master-data:audit-tenancy'))->toBe(1);
});
