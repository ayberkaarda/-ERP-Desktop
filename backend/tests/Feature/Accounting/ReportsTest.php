<?php

declare(strict_types=1);

use App\Modules\Accounting\Reports\Data\Source;
use App\Modules\Accounting\Reports\Http\Resources\JournalBookEntryResource;
use App\Modules\Accounting\Reports\Http\Resources\TrialBalanceResource;
use App\Modules\Accounting\Reports\Services\GeneralLedgerReport;
use App\Modules\Accounting\Reports\Services\JournalBookReport;
use App\Modules\Accounting\Reports\Services\RangeResolver;
use App\Modules\Accounting\Reports\Services\TrialBalanceReport;
use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Data\PartyData;
use App\Modules\Parties\Enums\PartyRole;
use App\Modules\Parties\Enums\PartyType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Accounting\Books;
use Tests\Support\Accounting\ReportBooks;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->ids = ReportBooks::seed($this->company);
    $this->user = Actors::user(['accounting.reports.view'], $this->company);
    $this->get = fn (string $uri): TestResponse => Books::as($this->user, $this->company)->getJson('/api/v1/reports/'.$uri);
    $this->period = fn (int $n): string => Books::period($this->company, '2027', $n)->id;
});

/**
 * @param  list<array<string, mixed>>  $rows
 * @return array<string, array<string, mixed>>
 */
function byCode(array $rows): array
{
    return collect($rows)->keyBy('code')->all();
}

it('builds the trial balance of a period from account_balances with the worked numbers', function (): void {
    $data = ($this->get)('trial-balance?period_id='.($this->period)(2))->assertOk()->json('data');
    $rows = byCode($data['rows']);

    expect($data['source'])->toBe('balances')
        ->and($data['date_from'])->toBe('2027-02-01')
        ->and($data['date_to'])->toBe('2027-02-28')
        ->and(Arr::only($rows['100'], ['opening_debit', 'opening_credit', 'debit', 'credit', 'total_debit', 'total_credit', 'balance_debit', 'balance_credit']))->toBe([
            'opening_debit' => '10000.0000', 'opening_credit' => '0.0000', 'debit' => '0.0000', 'credit' => '500.0000',
            'total_debit' => '10000.0000', 'total_credit' => '500.0000', 'balance_debit' => '9500.0000', 'balance_credit' => '0.0000',
        ])
        // Class 1 rolls up 100, 120, 153 and 191.
        ->and(Arr::only($rows['1'], ['opening_debit', 'debit', 'credit', 'balance_debit']))->toBe([
            'opening_debit' => '10000.0000', 'debit' => '6000.0000', 'credit' => '500.0000', 'balance_debit' => '15500.0000',
        ])
        ->and($rows['10']['balance_debit'])->toBe('9500.0000')
        ->and($rows['320']['balance_credit'])->toBe('2400.0000')
        ->and($rows['500']['opening_credit'])->toBe('10000.0000')
        ->and($rows['500']['balance_credit'])->toBe('10000.0000')
        ->and($rows['770']['debit'])->toBe('500.0000')
        ->and(Arr::only($data['totals'], ['opening_debit', 'opening_credit', 'debit', 'credit', 'total_debit', 'total_credit']))->toBe([
            'opening_debit' => '10000.0000', 'opening_credit' => '10000.0000', 'debit' => '6500.0000', 'credit' => '6500.0000',
            'total_debit' => '16500.0000', 'total_credit' => '16500.0000',
        ])
        ->and($data['balanced'])->toBeTrue()
        ->and($data['difference'])->toBe('0.0000');

    $groups = collect($data['groups'])->keyBy('tdhp_group');
    expect($groups[1]['name'])->toBe('DÖNEN VARLIKLAR')
        ->and($groups[1]['balance_debit'])->toBe('15500.0000')
        ->and($groups[3]['balance_credit'])->toBe('3000.0000')
        ->and($groups[6]['balance_credit'])->toBe('3000.0000')
        ->and($groups[7]['balance_debit'])->toBe('500.0000');
});

it('limits rows to a level and shows accounts without bookings only with include_zero', function (): void {
    $levelOne = ($this->get)('trial-balance?date_from=2027-01-01&date_to=2027-12-31&level=1')->assertOk()->json('data.rows');
    expect(array_column($levelOne, 'code'))->toBe(['1', '3', '5', '6', '7']);

    $without = array_column(($this->get)('trial-balance?date_from=2027-01-01&date_to=2027-12-31&level=2')->json('data.rows'), 'code');
    $with = array_column(($this->get)('trial-balance?date_from=2027-01-01&date_to=2027-12-31&level=2&include_zero=1')->json('data.rows'), 'code');

    expect($without)->not->toContain('59')->not->toContain('100')
        ->and($with)->toContain('59')->toContain('19')
        ->and(count($with))->toBeGreaterThan(count($without));
});

it('reads the booked lines for a range that splits periods, with inclusive dates', function (): void {
    $data = ($this->get)('trial-balance?date_from=2027-02-10&date_to=2027-03-05')->assertOk()->json('data');
    $rows = byCode($data['rows']);

    // Opening: E1 and E2 (dated before 10 February); movement: E3, E5 and its reversal R5 (5 March, inclusive).
    expect($data['source'])->toBe('lines')
        ->and(Arr::only($rows['100'], ['opening_debit', 'debit', 'credit', 'balance_debit']))->toBe([
            'opening_debit' => '10000.0000', 'debit' => '500.0000', 'credit' => '500.0000', 'balance_debit' => '10000.0000',
        ])
        ->and(Arr::only($rows['770'], ['debit', 'credit', 'balance_debit', 'balance_credit']))->toBe([
            'debit' => '500.0000', 'credit' => '500.0000', 'balance_debit' => '0.0000', 'balance_credit' => '0.0000',
        ])
        ->and($rows['153']['opening_debit'])->toBe('2000.0000')
        ->and($rows['153']['debit'])->toBe('0.0000')
        ->and($rows)->not->toHaveKey('102')
        ->and($data['totals']['debit'])->toBe('4600.0000')
        ->and($data['balanced'])->toBeTrue();
});

it('counts posted and reversed entries but never drafts', function (): void {
    $year = ($this->get)('trial-balance?date_from=2027-01-01&date_to=2027-12-31')->json('data');
    $march = byCode(($this->get)('trial-balance?period_id='.($this->period)(3))->json('data.rows'));

    // 10000 + 2400 + 3600 + 3600 + 500 (E5) + 500 (R5); the 999 draft is not there.
    expect($year['totals']['debit'])->toBe('20600.0000')
        ->and($year['totals']['credit'])->toBe('20600.0000')
        ->and(byCode($year['rows'])['770']['total_debit'])->toBe('500.0000')
        ->and(Arr::only($march['770'], ['opening_debit', 'debit', 'credit', 'balance_debit']))->toBe([
            'opening_debit' => '500.0000', 'debit' => '0.0000', 'credit' => '500.0000', 'balance_debit' => '0.0000',
        ]);
});

it('gives the same numbers from account_balances and from the lines', function (): void {
    [$stored, $computed] = Books::balanceSnapshots($this->company);
    expect($stored)->toEqual($computed);

    $request = Request::create('/');
    $ranges = app(RangeResolver::class);

    Books::in($this->company, function () use ($ranges, $request): void {
        $cases = [
            'period 1' => $ranges->forPeriod(Books::period($this->company, '2027', 1)),
            'period 2' => $ranges->forPeriod(Books::period($this->company, '2027', 2)),
            'period 3' => $ranges->forPeriod(Books::period($this->company, '2027', 3)),
            'first quarter' => $ranges->forDates('2027-01-01', '2027-03-31'),
            'february to march' => $ranges->forDates('2027-02-01', '2027-03-31'),
            'year' => $ranges->forDates('2027-01-01', '2027-12-31'),
        ];

        foreach ($cases as $name => $range) {
            expect($range->balancesUsable())->toBeTrue($name);

            $trial = fn (Source $source): array => Arr::except((new TrialBalanceResource(app(TrialBalanceReport::class)
                ->build($this->company, $range, null, true, false, $source)))->resolve($request), ['source']);
            expect($trial(Source::Balances))->toBe($trial(Source::Lines), $name);

            foreach (['100', '1', '120'] as $code) {
                $ledger = fn (Source $source): array => Arr::except((array) app(GeneralLedgerReport::class)
                    ->build($this->company, Books::account($this->company, $code), $range, 1, 50, $source), ['source']);
                expect($ledger(Source::Balances))->toEqual($ledger(Source::Lines), "{$name} {$code}");
            }

            $book = function (Source $source) use ($range, $request): array {
                $result = app(JournalBookReport::class)->build($this->company, $range, 1, 2, $source);

                return [
                    $result->carriedForward, $result->pageBroughtForward, $result->pageTotals, $result->rangeTotals,
                    array_map(fn ($e) => (new JournalBookEntryResource($e))->resolve($request), $result->entries),
                ];
            };
            expect($book(Source::Balances))->toEqual($book(Source::Lines), $name);
        }

        expect($ranges->forDates('2027-01-01', '2027-03-30')->balancesUsable())->toBeFalse()
            ->and($ranges->forDates('2027-01-02', '2027-03-31')->balancesUsable())->toBeFalse();
    });

    // A period-aligned date range answers like the period it covers.
    $byPeriod = ($this->get)('trial-balance?period_id='.($this->period)(3))->json('data');
    $byDates = ($this->get)('trial-balance?date_from=2027-03-01&date_to=2027-03-31')->json('data');
    expect(Arr::except($byDates, ['period_id']))->toBe(Arr::except($byPeriod, ['period_id']));
});

it('compares with the same period of the previous year', function (): void {
    Books::year($this->company, '2026');
    Books::post($this->company, '2026-02-10', [['100', '1000.00', '0'], ['500', '0', '1000.00']]);

    $data = ($this->get)('trial-balance?period_id='.($this->period)(2).'&compare_with_previous_year=1')->assertOk()->json('data');
    $rows = byCode($data['rows']);

    expect($data['previous_range'])->toBe([
        'date_from' => '2026-02-01', 'date_to' => '2026-02-28', 'period_id' => Books::period($this->company, '2026', 2)->id, 'source' => 'balances',
    ])
        ->and($rows['100']['previous']['debit'])->toBe('1000.0000')
        ->and($rows['100']['previous']['balance_debit'])->toBe('1000.0000')
        // The 2026 booking is before February 2027, so it is part of the opening now.
        ->and($rows['100']['opening_debit'])->toBe('11000.0000')
        ->and($rows['153']['previous']['debit'])->toBe('0.0000')
        ->and($data['previous_totals']['debit'])->toBe('1000.0000');

    // Date ranges move back one year; 29 February has no twin.
    $dated = ($this->get)('trial-balance?date_from=2027-02-01&date_to=2027-02-28&compare_with_previous_year=1')->json('data');
    expect($dated['previous_range']['date_from'])->toBe('2026-02-01')
        ->and(byCode($dated['rows'])['100']['previous']['debit'])->toBe('1000.0000');

    $plain = ($this->get)('trial-balance?period_id='.($this->period)(2))->json('data');
    expect($plain['previous_range'])->toBeNull()->and($plain['rows'][0]['previous'])->toBeNull();
});

it('lists the general ledger with opening, running balance across pages and closing', function (): void {
    $account = Books::account($this->company, '100')->id;
    $first = ($this->get)("general-ledger?account_id={$account}&date_from=2027-02-01&date_to=2027-03-31&per_page=1")->assertOk();
    $second = ($this->get)("general-ledger?account_id={$account}&date_from=2027-02-01&date_to=2027-03-31&per_page=1&page=2")->assertOk();

    expect($first->json('meta.opening_balance'))->toBe('10000.0000')
        ->and($first->json('meta.closing_balance'))->toBe('10000.0000')
        ->and($first->json('meta.totals'))->toBe(['debit' => '500.0000', 'credit' => '500.0000'])
        ->and($first->json('meta.source'))->toBe('balances')
        ->and($first->json('meta.account.code'))->toBe('100')
        ->and($first->json('meta.pagination'))->toBe(['current_page' => 1, 'per_page' => 1, 'total' => 2, 'last_page' => 2])
        ->and($first->json('data.0'))->toMatchArray([
            'entry_id' => $this->ids['E5'], 'entry_date' => '2027-02-25', 'entry_status' => 'reversed', 'debit' => '0.0000',
            'credit' => '500.0000', 'running_balance' => '9500.0000', 'account_code' => '100',
        ])
        ->and($second->json('data.0'))->toMatchArray([
            'entry_id' => $this->ids['R5'], 'entry_type' => 'reversal', 'debit' => '500.0000', 'running_balance' => '10000.0000',
        ]);

    // A parent account covers its sub-accounts; a range splitting periods reads the lines.
    $parent = ($this->get)('general-ledger?account_id='.Books::account($this->company, '12')->id.'&date_from=2027-02-21&date_to=2027-03-31')->assertOk();
    expect($parent->json('meta.source'))->toBe('lines')
        ->and($parent->json('meta.opening_balance'))->toBe('3600.0000')
        ->and($parent->json('data'))->toHaveCount(1)
        ->and($parent->json('data.0.account_code'))->toBe('120')
        ->and($parent->json('data.0.running_balance'))->toBe('0.0000')
        ->and($parent->json('meta.closing_balance'))->toBe('0.0000');

    // Credit balances are negative.
    $sales = ($this->get)('general-ledger?account_id='.Books::account($this->company, '600')->id.'&period_id='.($this->period)(2))->json();
    expect($sales['data'][0]['running_balance'])->toBe('-3000.0000')->and($sales['meta']['closing_balance'])->toBe('-3000.0000');
});

it('prints the journal book in number order with devreden and nakledilen totals', function (): void {
    $page = ($this->get)('journal-book?date_from=2027-01-01&date_to=2027-12-31&per_page=2&page=2')->assertOk();

    expect(array_column($page->json('data'), 'number'))->toBe(['2027000000003', '2027000000004'])
        ->and($page->json('data.0.lines'))->toHaveCount(3)
        ->and($page->json('data.0.lines.0'))->toMatchArray(['line_no' => 1, 'account_code' => '120', 'debit' => '3600.0000', 'credit' => '0.0000'])
        ->and($page->json('meta.carried_forward'))->toBe(['debit' => '0.0000', 'credit' => '0.0000'])
        ->and($page->json('meta.page_brought_forward'))->toBe(['debit' => '12400.0000', 'credit' => '12400.0000'])
        ->and($page->json('meta.page_totals'))->toBe(['debit' => '7200.0000', 'credit' => '7200.0000'])
        ->and($page->json('meta.page_carried_forward'))->toBe(['debit' => '19600.0000', 'credit' => '19600.0000'])
        ->and($page->json('meta.range_totals'))->toBe(['debit' => '20600.0000', 'credit' => '20600.0000'])
        ->and($page->json('meta.pagination.total'))->toBe(6);

    // March: January and February of the same fiscal year are brought forward; the draft is absent.
    foreach (['period_id='.($this->period)(3) => 'balances', 'date_from=2027-03-01&date_to=2027-03-20' => 'lines'] as $query => $source) {
        $march = ($this->get)("journal-book?{$query}")->assertOk();
        expect($march->json('meta.source'))->toBe($source)
            ->and(array_column($march->json('data'), 'id'))->toBe([$this->ids['E4'], $this->ids['R5']])
            ->and($march->json('meta.carried_forward'))->toBe(['debit' => '16500.0000', 'credit' => '16500.0000'])
            ->and($march->json('meta.page_carried_forward'))->toBe(['debit' => '20600.0000', 'credit' => '20600.0000']);
    }
});

it('builds the account statement of a party within an account range', function (): void {
    [$p0, $p1] = Books::$parties;

    $march = ($this->get)("account-statement?party_id={$p1}&account_from=120&account_to=120&date_from=2027-03-01&date_to=2027-03-31")->assertOk();
    expect($march->json('meta.opening_balance'))->toBe('3600.0000')
        ->and($march->json('meta.source'))->toBe('lines')
        ->and($march->json('data'))->toHaveCount(1)
        ->and($march->json('data.0'))->toMatchArray(['entry_id' => $this->ids['E4'], 'credit' => '3600.0000', 'running_balance' => '0.0000'])
        ->and($march->json('meta.closing_balance'))->toBe('0.0000');

    $year = ($this->get)("account-statement?party_id={$p1}&date_from=2027-01-01&date_to=2027-12-31")->json();
    expect(array_column($year['data'], 'running_balance'))->toBe(['3600.0000', '0.0000'])
        ->and($year['meta']['totals'])->toBe(['debit' => '3600.0000', 'credit' => '3600.0000']);

    $supplier = ($this->get)("account-statement?party_id={$p0}&period_id=".($this->period)(2))->json();
    expect($supplier['data'][0])->toMatchArray(['account_code' => '320', 'credit' => '2400.0000', 'running_balance' => '-2400.0000']);

    $outside = ($this->get)("account-statement?party_id={$p0}&account_from=100&account_to=199&date_from=2027-01-01&date_to=2027-12-31")->json();
    expect($outside['data'])->toBe([])->and($outside['meta']['closing_balance'])->toBe('0.0000');
});

it('rejects invalid parameters with the validation envelope', function (string $uri, string $field): void {
    $response = ($this->get)($uri)->assertStatus(422);

    expect($response->json('errors.code'))->toBe('VALIDATION_ERROR')
        ->and($response->json('errors.fields'))->toHaveKey($field);
})->with([
    'no range' => ['trial-balance', 'date_from'],
    'period and dates' => ['trial-balance?period_id=01900000-0000-7000-8000-000000000000&date_from=2027-01-01&date_to=2027-01-31', 'period_id'],
    'reversed dates' => ['trial-balance?date_from=2027-02-01&date_to=2027-01-31', 'date_to'],
    'impossible date' => ['trial-balance?date_from=2027-02-30&date_to=2027-03-01', 'date_from'],
    'level zero' => ['trial-balance?date_from=2027-01-01&date_to=2027-01-31&level=0', 'level'],
    'bad flag' => ['trial-balance?date_from=2027-01-01&date_to=2027-01-31&include_zero=maybe', 'include_zero'],
    'ledger without account' => ['general-ledger?date_from=2027-01-01&date_to=2027-01-31', 'account_id'],
    'page too large' => ['journal-book?date_from=2027-01-01&date_to=2027-01-31&per_page=501', 'per_page'],
    'statement without party' => ['account-statement?date_from=2027-01-01&date_to=2027-01-31', 'party_id'],
    'bad export format' => ['trial-balance/export?date_from=2027-01-01&date_to=2027-01-31&format=pdf', 'format'],
]);

it('never lets account_balances answer a range that splits the zero-length adjustment period', function (): void {
    Books::year($this->company, '2028', adjustment: true);

    Books::in($this->company, function (): void {
        $ranges = app(RangeResolver::class);

        expect($ranges->forDates('2028-12-01', '2028-12-31')->balancesUsable())->toBeTrue()
            ->and($ranges->forDates('2028-01-01', '2028-12-31')->balancesUsable())->toBeTrue()
            // Period 12 ends on 31 December too, so this range would split it.
            ->and($ranges->forDates('2028-12-31', '2028-12-31')->balancesUsable())->toBeFalse()
            ->and($ranges->forPeriod(Books::period($this->company, '2028', 13))->balancesUsable())->toBeTrue();
    });
});

it('names the party of ledger lines only when it belongs to the active company', function (): void {
    [$p0, $p1] = Books::$parties;
    $company = $this->company;
    $party = fn (string $id, string $owner, string $code): PartyData => new PartyData(
        $id, $owner, $code, "Party {$code}", null, PartyType::Company, [PartyRole::Customer], null, null, 'TR', null, null, null, null, null, true,
    );
    app()->instance(PartyLookup::class, new class($party($p0, (string) Str::uuid7(), 'FOREIGN'), $party($p1, $company, 'C-1')) implements PartyLookup
    {
        public function __construct(private readonly PartyData $foreign, private readonly PartyData $own) {}

        public function find(string $id): ?PartyData
        {
            return [$this->foreign->id => $this->foreign, $this->own->id => $this->own][$id] ?? null;
        }

        public function findByCode(string $code): ?PartyData
        {
            return null;
        }

        public function exists(string $id): bool
        {
            return $this->find($id) !== null;
        }
    });

    $receivables = ($this->get)('general-ledger?account_id='.Books::account($this->company, '120')->id.'&period_id='.($this->period)(2))->json();
    $statement = ($this->get)("account-statement?party_id={$p0}&period_id=".($this->period)(2))->json();

    expect($receivables['data'][0]['party'])->toBe(['id' => $p1, 'code' => 'C-1', 'name' => 'Party C-1'])
        ->and($statement['data'][0]['party_id'])->toBe($p0)
        ->and($statement['data'][0]['party'])->toBeNull()
        ->and($statement['meta']['party'])->toBeNull();
});
