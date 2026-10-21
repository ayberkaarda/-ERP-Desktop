<?php

declare(strict_types=1);

namespace Tests\Support\Accounting;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostedEntry;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Services\BalanceBook;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Organization\Models\Company;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Data\PartyData;
use App\Modules\Reference\Contracts\CurrencyLookup;
use App\Modules\Reference\Contracts\DimensionLookup;
use App\Modules\Reference\Services\CurrencyCatalog;
use Closure;
use DateTimeImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\Actors;
use Tests\Support\Identity;

/**
 * Ledger fixtures: companies bootstrapped with the small fixture chart (as CompanyCreated does),
 * fiscal years, postings through the PostingService contract and an API client.
 * The clock is fixed at 2027-06-15 so the bootstrapped "current" fiscal year is always 2027.
 */
final class Books
{
    public const string TODAY = '2027-06-15 10:00:00';

    public const array ALL = [
        'accounting.accounts.view', 'accounting.accounts.manage', 'accounting.periods.view', 'accounting.periods.manage',
        'accounting.periods.close', 'accounting.periods.reopen', 'accounting.year.close', 'accounting.entries.view',
        'accounting.entries.create', 'accounting.entries.post', 'accounting.entries.post_soft_closed', 'accounting.entries.reverse',
        'accounting.determination.manage', 'accounting.revaluation.run', 'accounting.reports.view',
    ];

    /** @var list<string> */
    public static array $parties = [];

    /** @var list<string> */
    public static array $costCenters = [];

    /** @var list<string> */
    public static array $projects = [];

    public static function fixtureChart(): string
    {
        return dirname(__DIR__, 2).'/Fixtures/Accounting/chart.json';
    }

    /**
     * Fixed clock, fixture chart, fake party/dimension/currency lookups. The faked ids and codes
     * exist as rows too (owned by a separate company), because journal lines have foreign keys to
     * parties, cost centers, projects and currencies.
     */
    public static function boot(bool $referenceRows = true): void
    {
        Carbon::setTestNow(self::TODAY);
        config(['accounting.chart_path' => self::fixtureChart()]);
        self::$parties = [(string) Str::uuid7(), (string) Str::uuid7()];
        self::$costCenters = [(string) Str::uuid7()];
        self::$projects = [(string) Str::uuid7()];
        self::fakeReferences();
        if ($referenceRows) {
            self::referenceRows();
        }
    }

    /** Rows behind the faked lookups (a party lookup still decides what the company may use). */
    public static function referenceRows(): void
    {
        CurrencyCatalog::ensure(['TRY', 'USD', 'EUR']);
        $owner = Company::factory()->create()->id;
        $stamp = ['company_id' => $owner, 'version' => 1, 'created_at' => now(), 'updated_at' => now()];
        foreach (self::$parties as $i => $id) {
            DB::table('parties')->insert(['id' => $id, 'code' => 'BK'.($i + 1), 'name' => 'Ledger party '.($i + 1), 'type' => 'company',
                'roles' => '["customer"]', 'tags' => '[]', 'country' => 'TR', 'is_active' => true, ...$stamp]);
        }
        foreach (self::$costCenters as $i => $id) {
            DB::table('cost_centers')->insert(['id' => $id, 'code' => 'BK'.($i + 1), 'name' => 'Ledger cost center', 'is_active' => true, ...$stamp]);
        }
        foreach (self::$projects as $i => $id) {
            DB::table('projects')->insert(['id' => $id, 'code' => 'BK'.($i + 1), 'name' => 'Ledger project', ...$stamp]);
        }
    }

    /** A company bootstrapped like a real one: fixture chart, default rules, fiscal year 2027. */
    public static function company(): string
    {
        return Actors::company();
    }

    public static function fakeReferences(): void
    {
        app()->instance(PartyLookup::class, new class implements PartyLookup
        {
            public function find(string $id): ?PartyData
            {
                return null;
            }

            public function findMany(array $ids): array
            {
                return [];
            }

            public function findByCode(string $code): ?PartyData
            {
                return null;
            }

            public function exists(string $id): bool
            {
                return in_array($id, Books::$parties, true);
            }
        });

        app()->instance(DimensionLookup::class, new class implements DimensionLookup
        {
            public function exists(string $id): bool
            {
                return $this->costCenterExists($id) || $this->projectExists($id);
            }

            public function costCenterExists(string $id): bool
            {
                return in_array($id, Books::$costCenters, true);
            }

            public function projectExists(string $id): bool
            {
                return in_array($id, Books::$projects, true);
            }
        });

        app()->instance(CurrencyLookup::class, new class implements CurrencyLookup
        {
            public function exists(string $code): bool
            {
                return in_array($code, ['TRY', 'USD', 'EUR'], true);
            }
        });
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public static function in(string $company, Closure $fn): mixed
    {
        return app(CompanyContext::class)->runAs($company, $fn);
    }

    public static function year(string $company, string $code, bool $adjustment = false): FiscalYear
    {
        return self::in($company, fn (): FiscalYear => app(FiscalCalendar::class)->create([
            'code' => $code, 'start_date' => "{$code}-01-01", 'end_date' => "{$code}-12-31", 'adjustment_period' => $adjustment,
        ]));
    }

    public static function fiscalYear(string $company, string $code): FiscalYear
    {
        return self::in($company, fn (): FiscalYear => FiscalYear::query()->where('code', $code)->firstOrFail());
    }

    public static function period(string $company, string $yearCode, int $number): AccountingPeriod
    {
        return self::in($company, fn (): AccountingPeriod => AccountingPeriod::query()
            ->where('fiscal_year_id', self::fiscalYear($company, $yearCode)->id)->where('number', $number)->firstOrFail());
    }

    public static function account(string $company, string $code): Account
    {
        return self::in($company, fn (): Account => Account::query()->where('code', $code)->firstOrFail());
    }

    /**
     * @param  list<array{0: string, 1: string, 2: string, 3?: array<string, string|null>}>  $lines  [code, debit, credit, extra]
     */
    public static function post(string $company, string $date, array $lines, EntryType $type = EntryType::General, ?string $source = null, ?string $sourceId = null, string $purpose = 'main', bool $allowSoftClosed = false): PostedEntry
    {
        $postingLines = array_map(static fn (array $l): PostingLine => $l[1] !== '0'
            ? PostingLine::debit($l[0], $l[1], $l[3] ?? [])
            : PostingLine::credit($l[0], $l[2], $l[3] ?? []), $lines);

        return app(PostingService::class)->post(new PostingRequest(
            $company, new DateTimeImmutable($date), $type, 'Test entry', $source, $sourceId, $postingLines, $purpose, allowSoftClosed: $allowSoftClosed,
        ));
    }

    /** Debit-positive booked balance of an account code, optionally up to a date. */
    public static function balance(string $company, string $code, ?string $asOf = null): string
    {
        return self::in($company, fn (): string => (string) app(BalanceBook::class)->accountAsOf(
            self::account($company, $code)->id,
            $asOf === null ? null : new DateTimeImmutable($asOf),
        )['balance']);
    }

    /**
     * account_balances rows equal SUM over booked lines, per (account, period).
     *
     * @return array{0: list<array<string, string>>, 1: list<array<string, string>>}
     */
    public static function balanceSnapshots(string $company): array
    {
        $stored = DB::table('account_balances')->where('company_id', $company)
            ->orderBy('account_id')->orderBy('period_id')
            ->get(['account_id', 'period_id', 'debit_total', 'credit_total'])
            ->map(fn (object $r): array => (array) $r)->all();
        $computed = DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.entry_id')
            ->where('e.company_id', $company)->where('e.status', '<>', 'draft')
            ->groupBy('l.account_id', 'e.period_id')
            ->orderBy('l.account_id')->orderBy('e.period_id')
            ->selectRaw('l.account_id, e.period_id, sum(l.debit) as debit_total, sum(l.credit) as credit_total')
            ->get()->map(fn (object $r): array => (array) $r)->all();

        return [array_values($stored), array_values($computed)];
    }

    /**
     * Acting user + active company headers; per-request state is reset like on a real server.
     */
    public static function as(User $user, string $company): mixed
    {
        Identity::fresh();

        return test()->actingAs($user, 'web')->withHeaders(['X-Company-Id' => $company, 'Accept' => 'application/json']);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return TestResponse<Response>
     */
    public static function postJson(User $user, string $company, string $uri, array $data = []): TestResponse
    {
        return self::as($user, $company)->postJson('/api/v1/'.$uri, $data, ['Idempotency-Key' => (string) Str::uuid7()]);
    }
}
