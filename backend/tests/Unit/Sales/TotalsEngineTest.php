<?php

declare(strict_types=1);

use App\Modules\Sales\Enums\RoundingScope;
use App\Modules\Sales\Services\Totals\LineInput;
use App\Modules\Sales\Services\Totals\TotalsEngine;
use App\Modules\Sales\Services\Totals\TotalsResult;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

function salesTotals(array $lines, RoundingScope $scope = RoundingScope::PerLine, string $fx = '1'): TotalsResult
{
    return (new TotalsEngine)->compute($lines, $scope, $fx);
}

it('computes net, discounts, tax and totals per line', function (): void {
    $r = salesTotals([
        new LineInput('5', '100', '10', '0', '20'),
        new LineInput('1', '200', '0', '15', '10'),
    ]);

    expect($r->lines[0]->gross)->toBe('500.00')->and($r->lines[0]->lineDiscount)->toBe('50.00')
        ->and($r->lines[0]->net)->toBe('450.00')->and($r->lines[0]->tax)->toBe('90.00')->and($r->lines[0]->lineTotal)->toBe('540.00')
        ->and($r->lines[1]->net)->toBe('185.00')->and($r->lines[1]->tax)->toBe('18.50')
        ->and($r->subtotal)->toBe('700.00')->and($r->discountTotal)->toBe('65.00')
        ->and($r->taxTotal)->toBe('108.50')->and($r->total)->toBe('743.50')
        ->and($r->totalLocal)->toBe('743.50');
});

it('rounds half up per line and keeps total = subtotal - discount + tax', function (): void {
    // 3 x 0.335 = 1.005 -> 1.01 net; tax 18% of 1.01 = 0.1818 -> 0.18.
    $r = salesTotals([new LineInput('3', '0.335', '0', '0', '18'), new LineInput('1', '0.005', '0', '0', '18')]);

    expect($r->lines[0]->net)->toBe('1.01')->and($r->lines[0]->tax)->toBe('0.18')
        ->and($r->lines[1]->net)->toBe('0.01')->and($r->lines[1]->tax)->toBe('0.00')
        ->and(BigDecimal::of($r->subtotal)->minus($r->discountTotal)->plus($r->taxTotal)->isEqualTo($r->total))->toBeTrue();
});

it('per_total rounding computes tax once per tax code and allocates it back to the lines', function (): void {
    $lines = [];

    for ($i = 0; $i < 3; $i++) {
        $lines[] = new LineInput('1', '0.10', '0', '0', '18', false, 'vat18');
    }

    $perLine = salesTotals($lines);
    $perTotal = salesTotals($lines, RoundingScope::PerTotal);

    // Per line: 3 x round(0.018) = 0.06; per total: round(0.30 x 18%) = 0.05, spread 0.02 + 0.02 + 0.01.
    expect($perLine->taxTotal)->toBe('0.06')
        ->and($perTotal->taxTotal)->toBe('0.05')
        ->and(array_map(fn ($l) => $l->tax, $perTotal->lines))->toBe(['0.02', '0.02', '0.01'])
        ->and($perTotal->total)->toBe('0.35')
        ->and($perTotal->taxes)->toHaveCount(1)
        ->and($perTotal->taxes[0]->tax)->toBe('0.05');
});

it('derives net from tax-inclusive prices and keeps the gross amount the customer sees', function (): void {
    $r = salesTotals([new LineInput('1', '118', '0', '0', '18', true), new LineInput('3', '9.99', '0', '0', '20', true)]);

    expect($r->lines[0]->net)->toBe('100.00')->and($r->lines[0]->tax)->toBe('18.00')->and($r->lines[0]->lineTotal)->toBe('118.00')
        ->and($r->lines[1]->lineTotal)->toBe('29.97')->and($r->lines[1]->net)->toBe('24.98')->and($r->lines[1]->tax)->toBe('4.99')
        ->and($r->total)->toBe('147.97');
});

it('keeps company currency totals consistent: tax per code converted, net as the difference', function (): void {
    $r = salesTotals([
        new LineInput('1', '33.33', '0', '0', '20', false, 'a'),
        new LineInput('1', '66.67', '0', '0', '10', false, 'b'),
    ], RoundingScope::PerLine, '34.567891');

    $taxLocal = BigDecimal::zero();

    foreach ($r->taxes as $tax) {
        $taxLocal = $taxLocal->plus($tax->taxLocal);
        expect($tax->taxLocal)->toBe((string) BigDecimal::of($tax->tax)->multipliedBy('34.567891')->toScale(2, RoundingMode::HalfUp));
    }

    expect($r->totalLocal)->toBe((string) BigDecimal::of($r->total)->multipliedBy('34.567891')->toScale(2, RoundingMode::HalfUp))
        ->and($r->taxTotalLocal)->toBe((string) $taxLocal->toScale(2))
        ->and(BigDecimal::of($r->subtotalLocal)->minus($r->discountTotalLocal)->plus($r->taxTotalLocal)->isEqualTo($r->totalLocal))->toBeTrue();
});

it('groups tax by code and rate and handles untaxed lines', function (): void {
    $r = salesTotals([
        new LineInput('2', '10', '0', '0', '20', false, 'x'),
        new LineInput('1', '5', '0', '0', '0', false, null),
        new LineInput('1', '10', '0', '0', '20', false, 'x'),
    ]);

    expect($r->taxes)->toHaveCount(2)
        ->and($r->taxes[0]->base)->toBe('30.00')->and($r->taxes[0]->tax)->toBe('6.00')
        ->and($r->taxes[1]->rate)->toBe('0.0000')->and($r->taxes[1]->tax)->toBe('0.00')
        ->and($r->total)->toBe('41.00');
});

it('handles quantities and prices with six decimals without floats', function (): void {
    $r = salesTotals([new LineInput('0.333333', '3.000003', '12.5', '0.01', '1')]);

    // 0.333333 x 3.000003 = 0.999999999999; x 0.875 = 0.874999...; - 0.01 = 0.864999... -> 0.86
    expect($r->lines[0]->net)->toBe('0.86')->and($r->lines[0]->gross)->toBe('1.00')->and($r->lines[0]->lineDiscount)->toBe('0.14');
});
