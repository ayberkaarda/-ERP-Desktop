<?php

declare(strict_types=1);

use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Services\EloquentPartyLookup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Tests\Support\Accounting\Books;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Books::boot();
    $this->company = Books::company();
    $this->user = Actors::user(['accounting.reports.view'], $this->company);
    $this->get = fn (string $uri): TestResponse => Books::as($this->user, $this->company)->get('/api/v1/reports/'.$uri, ['Accept' => 'application/json']);
});

it('sums debit and credit balances of separate accounts without netting them', function (): void {
    Books::post($this->company, '2027-01-10', [['100', '100.00', '0'], ['500', '0', '100.00']]);

    $data = ($this->get)('trial-balance?period_id='.Books::period($this->company, '2027', 1)->id)->assertOk()->json('data');
    $groups = collect($data['groups'])->keyBy('tdhp_group');

    expect($data['totals']['balance_debit'])->toBe('100.0000')
        ->and($data['totals']['balance_credit'])->toBe('100.0000')
        ->and($data['balanced'])->toBeTrue()
        ->and($groups[1]['balance_debit'])->toBe('100.0000')
        ->and($groups[5]['balance_credit'])->toBe('100.0000');

    // Inside one class, opposing accounts keep their own sides too (income 600 vs expense 621).
    Books::post($this->company, '2027-01-20', [['621', '40.00', '0'], ['600', '0', '40.00']]);
    $class6 = collect(($this->get)('trial-balance?period_id='.Books::period($this->company, '2027', 1)->id)->json('data.groups'))->keyBy('tdhp_group')[6];
    expect($class6['balance_debit'])->toBe('40.0000')->and($class6['balance_credit'])->toBe('40.0000');
});

it('keeps the largest amounts exact as text cells in XLSX', function (): void {
    Books::post($this->company, '2027-01-10', [['100', '9999999999999999.9999', '0'], ['500', '0', '9999999999999999.9999']]);

    $response = ($this->get)('trial-balance/export?period_id='.Books::period($this->company, '2027', 1)->id.'&format=xlsx')->assertOk();
    $sheet = IOFactory::load($response->baseResponse->getFile()->getPathname())->getActiveSheet();
    $cash = null;

    foreach ($sheet->getRowIterator() as $row) {
        if ($sheet->getCell('A'.$row->getRowIndex())->getValue() === '100') {
            $cash = $row->getRowIndex();
        }
    }

    expect($cash)->not->toBeNull();
    $debit = $sheet->getCell('G'.$cash);
    $balance = $sheet->getCell('K'.$cash);

    expect($debit->getDataType())->toBe(DataType::TYPE_STRING)
        ->and($debit->getValue())->toBe('9999999999999999.9999')
        ->and($balance->getValue())->toBe('9999999999999999.9999');
});

it('loads the parties of a ledger page with one query', function (): void {
    $other = Books::company();
    $foreign = Books::in($other, fn () => Party::factory()->create());
    $parties = Books::in($this->company, fn () => Party::factory()->count(29)->create());
    // Posted while the fake lookup accepts every id, so one line carries a party of another company.
    Books::$parties = [...$parties->pluck('id')->all(), $foreign->id];
    $lines = array_map(fn (string $id): array => ['120', '10.00', '0', ['partyId' => $id]], Books::$parties);
    $lines[] = ['600', '0', '300.00'];
    Books::post($this->company, '2027-01-10', $lines);
    app()->instance(PartyLookup::class, new EloquentPartyLookup);

    DB::flushQueryLog();
    DB::enableQueryLog();
    $response = ($this->get)('general-ledger?per_page=100&period_id='.Books::period($this->company, '2027', 1)->id.'&account_id='.Books::account($this->company, '120')->id)->assertOk();
    $partyQueries = collect(DB::getQueryLog())->filter(fn (array $q): bool => str_contains($q['query'], '"parties"'))->count();
    DB::disableQueryLog();

    $named = collect($response->json('data'))->whereNotNull('party');
    expect($partyQueries)->toBe(1)
        ->and($named)->toHaveCount(29)
        ->and(collect($response->json('data'))->firstWhere('party_id', $foreign->id)['party'])->toBeNull()
        ->and($named->first()['party'])->toHaveKeys(['id', 'code', 'name']);
});

it('compares with the dates one year back when the previous fiscal year is missing', function (): void {
    Books::year($this->company, '2025');
    Books::post($this->company, '2025-02-10', [['100', '70.00', '0'], ['500', '0', '70.00']]);

    $data = ($this->get)('trial-balance?compare_with_previous_year=1&period_id='.Books::period($this->company, '2027', 2)->id)->assertOk()->json('data');

    // No 2026 fiscal year: February 2025 must not be taken as "the previous year".
    expect($data['previous_range'])->toBe(['date_from' => '2026-02-01', 'date_to' => '2026-02-28', 'period_id' => null, 'source' => 'balances'])
        ->and($data['previous_totals']['debit'])->toBe('0.0000');
});
