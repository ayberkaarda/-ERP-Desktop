<?php

declare(strict_types=1);

use App\Core\Money\RoundingPolicy;
use Brick\Math\BigDecimal;

it('rounds half up at the configured scales', function (): void {
    expect((string) RoundingPolicy::money('1.23445'))->toBe('1.2345')
        ->and((string) RoundingPolicy::money('-1.23445'))->toBe('-1.2345')
        ->and((string) RoundingPolicy::decimal('0.0000005'))->toBe('0.000001')
        ->and((string) RoundingPolicy::currency('2.675'))->toBe('2.68')
        ->and((string) RoundingPolicy::currency(3))->toBe('3.00')
        ->and(RoundingPolicy::MODE->name)->toBe('HalfUp');
});

it('allocates without losing or inventing a cent', function (array $weights, string $total, array $expected): void {
    $parts = RoundingPolicy::allocate($total, $weights);
    $sum = array_reduce($parts, fn (BigDecimal $c, BigDecimal $p): BigDecimal => $c->plus($p), BigDecimal::zero());

    expect(array_map('strval', $parts))->toBe($expected)
        ->and((string) $sum)->toBe((string) RoundingPolicy::currency($total));
})->with([
    'thirds' => [[1, 1, 1], '100', ['33.34', '33.33', '33.33']],
    'weighted' => [['2', '1'], '10.00', ['6.67', '3.33']],
    'negative' => [[1, 1, 1], '-0.10', ['-0.04', '-0.03', '-0.03']],
    'exact' => [['1', '3'], '4', ['1.00', '3.00']],
]);

it('refuses empty or zero weights', function (array $weights): void {
    expect(fn () => RoundingPolicy::allocate('1', $weights))->toThrow(InvalidArgumentException::class);
})->with([[[]], [[0, 0]]]);

it('compares remainders exactly, not after decimal truncation', function (): void {
    // Differences far below any fixed working precision must still pick the larger share.
    $parts = RoundingPolicy::allocate('0.01', ['1', '1.000000000000001', '1']);

    expect(array_map('strval', $parts))->toBe(['0.00', '0.01', '0.00']);
});
