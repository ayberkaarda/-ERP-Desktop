<?php

declare(strict_types=1);

use App\Modules\Purchasing\Enums\RoundingScope;
use App\Modules\Purchasing\Services\Totals\LineInput;
use App\Modules\Purchasing\Services\Totals\TotalsEngine;
use Brick\Math\BigDecimal;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

// The application is booted for the translated validation message of the refused discount.
uses(TestCase::class);

it('computes net, tax, withholding and totals per line with half-up rounding', function (): void {
    $result = (new TotalsEngine)->compute([
        new LineInput('3', '33.335', '0', '0', '20', false, 'vat', '50'),
        new LineInput('1', '10', '10', '1', '20', false, 'vat'),
    ], RoundingScope::PerLine, '1');

    // 100.005 -> 100.01; tax 20.002 -> 20.00; withholding 10.00. Second: 10 * 0.9 - 1 = 8.00, tax 1.60.
    expect($result->lines[0]->net)->toBe('100.01')
        ->and($result->lines[0]->tax)->toBe('20.00')
        ->and($result->lines[0]->withholding)->toBe('10.00')
        ->and($result->lines[1]->net)->toBe('8.00')
        ->and($result->lines[1]->lineDiscount)->toBe('2.00')
        ->and($result->lines[1]->withholding)->toBe('0.00')
        ->and($result->subtotal)->toBe('110.01')
        ->and($result->discountTotal)->toBe('2.00')
        ->and($result->taxTotal)->toBe('21.60')
        ->and($result->total)->toBe('129.61')
        ->and($result->withholdingTotal)->toBe('10.00');
});

it('rounds tax once per tax code with per_total and allocates it back to the lines', function (): void {
    $lines = [new LineInput('1', '0.03', '0', '0', '18'), new LineInput('1', '0.03', '0', '0', '18'), new LineInput('1', '0.03', '0', '0', '18')];
    $perLine = (new TotalsEngine)->compute($lines, RoundingScope::PerLine, '1');
    $perTotal = (new TotalsEngine)->compute($lines, RoundingScope::PerTotal, '1');

    // Per line: 0.0054 rounds to 0.01 three times; per total: 0.0162 -> 0.02 split 0.01/0.01/0.00.
    expect($perLine->taxTotal)->toBe('0.03')
        ->and($perTotal->taxTotal)->toBe('0.02')
        ->and(array_map(static fn ($l): string => $l->tax, $perTotal->lines))->toBe(['0.01', '0.01', '0.00']);
});

it('keeps the totals identity in company currency and caps withholding by the tax', function (): void {
    $result = (new TotalsEngine)->compute([
        new LineInput('7', '13.37', '0', '0', '20', false, 'vat', '90'),
        new LineInput('2', '0.333333', '0', '0', '10', false, 'vat10'),
    ], RoundingScope::PerLine, '32.123456');

    $local = BigDecimal::of($result->subtotalLocal)->minus($result->discountTotalLocal)->plus($result->taxTotalLocal);
    expect($local->isEqualTo($result->totalLocal))->toBeTrue()
        ->and(BigDecimal::of($result->withholdingTotalLocal)->isLessThanOrEqualTo($result->taxTotalLocal))->toBeTrue()
        ->and(BigDecimal::of($result->total)->isEqualTo(BigDecimal::of($result->subtotal)->minus($result->discountTotal)->plus($result->taxTotal)))->toBeTrue()
        ->and($result->taxes)->toHaveCount(2);
});

it('handles tax-inclusive prices and refuses discounts above the line amount', function (): void {
    $result = (new TotalsEngine)->compute([new LineInput('1', '120', '0', '0', '20', true)], RoundingScope::PerLine, '1');
    expect($result->lines[0]->net)->toBe('100.00')->and($result->lines[0]->tax)->toBe('20.00')->and($result->total)->toBe('120.00');

    expect(fn () => (new TotalsEngine)->compute([new LineInput('1', '10', '0', '11')], RoundingScope::PerLine, '1'))
        ->toThrow(ValidationException::class);
});
