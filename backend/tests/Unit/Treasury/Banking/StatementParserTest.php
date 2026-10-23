<?php

declare(strict_types=1);

use App\Modules\Treasury\Banking\Services\StatementParser;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

uses(TestCase::class);

function swiftStatement(string $transactions, string $closing = '120,00', string $opening = '100,00'): string
{
    return ":20:MT940\n:25:TR330006100519786457841326\n:28C:00001/001\n:60F:C270601TRY{$opening}\n{$transactions}\n:62F:C270630TRY{$closing}";
}

it('parses credit debit reversal marks and optional funds code without float rounding', function (): void {
    $content = swiftStatement(":61:2706150615CY30,00NTRFREF-A\n:86:Customer receipt\n:61:270616D20,00NTRFREF-B\n:61:270617RCY5,00NTRFREF-C\n:61:270618RD15,00NTRFREF-D");
    $data = app(StatementParser::class)->parse('mt940', $content);
    expect($data->currency)->toBe('TRY')->and($data->reference)->toBe('MT940/00001/001')
        ->and(array_map(fn ($line) => $line->amount, $data->lines))->toBe(['30.0000', '-20.0000', '-5.0000', '15.0000'])
        ->and($data->lines[0]->description)->toBe('Customer receipt');
});

it('rolls optional booking month across a year boundary', function (): void {
    $content = ":20:REF\n:25:TR330006100519786457841326\n:28C:1\n:60F:C261231TRY0,00\n:61:2612310101C10,00NTRFREF\n:62F:C270101TRY10,00";
    expect(app(StatementParser::class)->parse('mt940', $content)->lines[0]->date)->toBe('2027-01-01');
});

it('parses strict mapped csv and quoted decimal comma without thousands guessing', function (): void {
    $data = app(StatementParser::class)->parse('csv', "day;value;ref\n2027-06-15;0,10;=CMD\n2027-06-16;0,20;SECOND", [
        'delimiter' => 'semicolon', 'decimal_separator' => ',', 'mapping' => ['date' => 'day', 'amount' => 'value', 'reference' => 'ref'],
        'currency_code' => 'TRY', 'opening_balance' => '0', 'closing_balance' => '0.30',
    ]);
    expect($data->closing)->toBe('0.3000')->and($data->lines[0]->reference)->toBe('=CMD');
});

it('rejects malformed or unsupported mt940 records', function (string $content): void {
    expect(fn () => app(StatementParser::class)->parse('mt940', $content))->toThrow(ValidationException::class);
})->with([
    'wrong closing' => swiftStatement(':61:270615C20,00NTRFREF', '121,00'),
    'missing closing' => ":20:REF\n:25:ACCOUNT\n:28C:1\n:60F:C270601TRY100,00\n:61:270615C20,00NTRFREF",
    'multi account' => swiftStatement(':61:270615C20,00NTRFREF')."\n:25:OTHER",
    'intermediate opening' => str_replace(':60F:', ':60M:', swiftStatement(':61:270615C20,00NTRFREF')),
    'bad leap date' => swiftStatement(':61:270229C20,00NTRFREF'),
    'currency mismatch' => str_replace(':62F:C270630TRY', ':62F:C270630USD', swiftStatement(':61:270615C20,00NTRFREF')),
    'transport envelope' => '{1:F01...}'.swiftStatement(':61:270615C20,00NTRFREF'),
    'unknown tag' => swiftStatement(':61:270615C20,00NTRFREF')."\n:99:unsupported",
    'bad decimal' => swiftStatement(':61:270615C2.000,00NTRFREF'),
    'wrong funds code' => swiftStatement(':61:270615CX20,00NTRFREF'),
    'bad available balance' => swiftStatement(':61:270615C20,00NTRFREF')."\n:64:invalid",
    'bad statement sequence' => str_replace(':28C:00001/001', ':28C:invalid', swiftStatement(':61:270615C20,00NTRFREF')),
    'transaction after closing' => swiftStatement(':61:270615C20,00NTRFREF')."\n:61:270615C20,00NTRFREF",
]);

it('rejects ambiguous csv values and impossible dates', function (string $row): void {
    expect(fn () => app(StatementParser::class)->parse('csv', "date,amount\n".$row, ['currency_code' => 'TRY', 'opening_balance' => '0', 'closing_balance' => '1']))->toThrow(ValidationException::class);
})->with(['exponent' => '2027-06-15,1e0', 'grouping' => '2027-06-15,"1,000"', 'overflow date' => '2027-02-29,1', 'zero' => '2027-06-15,0', 'width' => '2027-06-15,1,extra']);

it('refuses oversized content and more than five thousand rows', function (): void {
    expect(fn () => app(StatementParser::class)->parse('csv', str_repeat('x', 2097153)))->toThrow(ValidationException::class);
    expect(fn () => app(StatementParser::class)->parse('csv', "date,amount\n".str_repeat("2027-06-15,1\n", 5001), ['currency_code' => 'TRY', 'opening_balance' => '0', 'closing_balance' => '5001']))->toThrow(ValidationException::class);
});
