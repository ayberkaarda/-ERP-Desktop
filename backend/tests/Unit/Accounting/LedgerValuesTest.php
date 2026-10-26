<?php

declare(strict_types=1);

use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Models\Account;
use App\Modules\Accounting\Services\ChartOfAccounts;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Accounting\Services\RuleDeterminer;
use App\Modules\Accounting\Support\LineInput;
use Brick\Math\BigDecimal;
use Carbon\CarbonImmutable;

it('matches rule conditions exactly, with lists as any-of and missing context as no match', function (array $conditions, array $context, bool $expected): void {
    expect(RuleDeterminer::matches($conditions, $context))->toBe($expected);
})->with([
    'no conditions' => [[], ['currency' => 'USD'], true],
    'equal' => [['currency' => 'USD'], ['currency' => 'USD'], true],
    'different' => [['currency' => 'USD'], ['currency' => 'EUR'], false],
    'missing in context' => [['currency' => 'USD'], [], false],
    'null in context' => [['currency' => 'USD'], ['currency' => null], false],
    'any of' => [['currency' => ['USD', 'EUR']], ['currency' => 'EUR'], true],
    'all keys' => [['currency' => 'USD', 'party_group' => 'export'], ['currency' => 'USD'], false],
    'int context' => [['item_category' => '7'], ['item_category' => 7], true],
]);

it('derives wildcard candidates from an event key', function (): void {
    expect(RuleDeterminer::candidateKeys('payroll.tax.income'))->toBe(['payroll.tax.income', 'payroll.tax.*', 'payroll.*'])
        ->and(RuleDeterminer::candidateKeys('fx'))->toBe(['fx']);
});

it('splits fiscal years into calendar-month periods', function (string $start, string $end, array $expected): void {
    $ranges = array_map(
        static fn (array $r): string => $r[0]->format('m-d').'..'.$r[1]->format('m-d'),
        FiscalCalendar::ranges(CarbonImmutable::parse($start), CarbonImmutable::parse($end)),
    );

    expect($ranges)->toBe($expected);
})->with([
    'calendar year' => ['2027-01-01', '2027-12-31', ['01-01..01-31', '02-01..02-28', '03-01..03-31', '04-01..04-30', '05-01..05-31', '06-01..06-30', '07-01..07-31', '08-01..08-31', '09-01..09-30', '10-01..10-31', '11-01..11-30', '12-01..12-31']],
    'leap february' => ['2028-02-01', '2028-03-31', ['02-01..02-29', '03-01..03-31']],
    'short first year' => ['2027-10-20', '2027-12-31', ['10-20..10-31', '11-01..11-30', '12-01..12-31']],
    'one day' => ['2027-12-31', '2027-12-31', ['12-31..12-31']],
]);

it('builds posting keys only for sourced requests', function (): void {
    $request = fn (?string $type, string $purpose = 'main') => new PostingRequest('c', new DateTimeImmutable('2027-01-01'), EntryType::General, null, $type, 'abc', [], $purpose);

    expect($request('sales_invoice')->postingKey())->toBe('sales_invoice|abc|main')
        ->and($request('sales_invoice', 'cogs')->postingKey())->toBe('sales_invoice|abc|cogs')
        ->and($request(null)->postingKey())->toBeNull()
        ->and($request('')->postingKey())->toBeNull()
        ->and(mb_strlen($request(str_repeat('x', 300))->postingKey() ?? ''))->toBe(255);
});

it('takes an account id or code in posting lines', function (): void {
    $byId = PostingLine::debit('01900000-0000-7000-8000-000000000000', '5', ['partyId' => 'p']);
    $byCode = PostingLine::credit('120.01', '5');

    expect($byId->accountId)->toBe('01900000-0000-7000-8000-000000000000')->and($byId->accountCode)->toBeNull()
        ->and($byId->debit)->toBe('5')->and($byId->credit)->toBe('0')->and($byId->partyId)->toBe('p')
        ->and($byCode->accountCode)->toBe('120.01')->and($byCode->accountId)->toBeNull()->and($byCode->credit)->toBe('5');
});

it('mirrors a line onto the other side keeping its dimensions', function (): void {
    $line = new LineInput(new Account, BigDecimal::of('10.5000'), BigDecimal::zero(), 'USD', BigDecimal::of('1'), BigDecimal::of('10.5'), 'party', 'cc', 'pr', 'd', '2027-01-31', 'ref');
    $mirror = $line->mirrored();

    expect((string) $mirror->debit)->toBe('0')->and((string) $mirror->credit)->toBe('10.5000')
        ->and([$mirror->currency, $mirror->partyId, $mirror->costCenterId, $mirror->projectId, $mirror->dueDate, $mirror->documentRef])
        ->toBe(['USD', 'party', 'cc', 'pr', '2027-01-31', 'ref']);
});

it('derives the TDHP group and the normal balance', function (): void {
    expect(ChartOfAccounts::groupOf('120.01'))->toBe(1)
        ->and(ChartOfAccounts::groupOf('0ABC'))->toBeNull()
        ->and(ChartOfAccounts::groupOf('X1'))->toBeNull()
        ->and(ChartOfAccounts::normalBalanceFor(AccountType::Revenue)->value)->toBe('credit')
        ->and(ChartOfAccounts::normalBalanceFor(AccountType::Cost)->value)->toBe('debit');
});

it('keeps manual entry types apart from generated ones', function (): void {
    expect(array_map(fn (EntryType $t): string => $t->value, EntryType::manual()))->toBe(['opening', 'general', 'receipt', 'payment', 'adjustment'])
        ->and(in_array(EntryType::Closing, EntryType::manual(), true))->toBeFalse();
});
