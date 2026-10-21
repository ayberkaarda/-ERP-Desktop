<?php

declare(strict_types=1);

use App\Modules\Catalog\Services\UnitGraph;
use Brick\Math\BigDecimal;
use Brick\Math\BigRational;
use Brick\Math\RoundingMode;

function unitGraphFixture(): UnitGraph
{
    // 1 box = 12 pcs, 1 pallet = 40 box, 1 kg = 1000 g; two separate trees.
    return new UnitGraph([
        ['from' => 'box', 'to' => 'pcs', 'factor' => '12'],
        ['from' => 'pallet', 'to' => 'box', 'factor' => '40'],
        ['from' => 'kg', 'to' => 'g', 'factor' => BigDecimal::of('1000.000000')],
    ]);
}

it('converts along an edge in both directions exactly', function (): void {
    expect((string) unitGraphFixture()->factor('box', 'pcs'))->toBe('12')
        ->and((string) unitGraphFixture()->factor('pcs', 'box'))->toBe('1/12')
        ->and((string) unitGraphFixture()->factor('g', 'kg'))->toBe('1/1000')
        ->and((string) unitGraphFixture()->factor('pcs', 'pcs'))->toBe('1');
});

it('multiplies factors over multi-hop paths without rounding', function (): void {
    $toPcs = unitGraphFixture()->factor('pallet', 'pcs');
    $back = unitGraphFixture()->factor('pcs', 'pallet');

    expect((string) $toPcs)->toBe('480')
        ->and((string) $back)->toBe('1/480')
        ->and($toPcs?->multipliedBy($back ?? BigRational::zero())->isEqualTo(1))->toBeTrue()
        // 1/480 is not a terminating decimal: callers choose the scale.
        ->and((string) $back?->toScale(6, RoundingMode::HalfUp))->toBe('0.002083');
});

it('returns null between unconnected units', function (): void {
    expect(unitGraphFixture()->factor('pcs', 'kg'))->toBeNull()
        ->and(unitGraphFixture()->connected('g', 'pallet'))->toBeFalse()
        ->and(unitGraphFixture()->connected('pallet', 'pcs'))->toBeTrue()
        ->and(unitGraphFixture()->factor('unknown', 'pcs'))->toBeNull();
});

it('refuses edges that would close a cycle, even with a consistent factor', function (): void {
    $graph = unitGraphFixture();

    expect($graph->wouldCreateCycle('pcs', 'pallet'))->toBeTrue()
        ->and($graph->wouldCreateCycle('box', 'pcs'))->toBeTrue()
        ->and($graph->wouldCreateCycle('pcs', 'pcs'))->toBeTrue()
        ->and($graph->wouldCreateCycle('kg', 'pcs'))->toBeFalse()
        ->and(fn () => $graph->add('pcs', 'pallet', '0.002083'))->toThrow(InvalidArgumentException::class, 'cycle')
        ->and(fn () => $graph->add('pcs', 'box', '0.083333'))->toThrow(InvalidArgumentException::class, 'cycle');
});

it('requires a positive factor between two distinct units', function (string $from, string $to, string $factor): void {
    expect(fn () => (new UnitGraph)->add($from, $to, $factor))->toThrow(InvalidArgumentException::class);
})->with([
    'zero' => ['a', 'b', '0'],
    'negative' => ['a', 'b', '-2'],
    'same unit' => ['a', 'a', '1'],
]);

it('lists a connected component', function (): void {
    expect(unitGraphFixture()->component('pcs'))->toEqualCanonicalizing(['pcs', 'box', 'pallet'])
        ->and(unitGraphFixture()->component('lonely'))->toBe(['lonely']);
});

it('joins two trees with a new edge', function (): void {
    $graph = unitGraphFixture();
    $graph->add('g', 'pcs', '0.5');

    expect((string) $graph->factor('kg', 'pallet'))->toBe('25/24')
        ->and($graph->wouldCreateCycle('kg', 'box'))->toBeTrue();
});
