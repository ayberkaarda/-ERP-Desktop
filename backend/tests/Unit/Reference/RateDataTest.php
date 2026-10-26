<?php

declare(strict_types=1);

use App\Core\Money\RoundingPolicy;
use App\Modules\Reference\Data\RateData;
use App\Modules\Reference\Enums\LocationType;
use App\Modules\Reference\Enums\NegativeStockPolicy;
use App\Modules\Reference\Enums\ProjectStatus;
use App\Modules\Reference\Enums\RateSource;
use App\Modules\Reference\Enums\TaxType;

it('preserves exact decimals across the rate DTO boundary', function (): void {
    $rate = new RateData('JPY', '2026-10-20', '0.223456', '0.224567', null, null);
    expect($rate->attributes())->toMatchArray([
        'currency_code' => 'JPY', 'forex_buying' => '0.223456',
        'forex_selling' => '0.224567', 'banknote_buying' => null, 'source' => 'tcmb',
    ]);
});

it('rejects unsupported domain statuses and types', function (string $enum): void {
    expect($enum::tryFrom('unsupported'))->toBeNull();
    expect(fn () => $enum::from('unsupported'))->toThrow(ValueError::class);
})->with([TaxType::class, RateSource::class, ProjectStatus::class, LocationType::class, NegativeStockPolicy::class]);

it('rounds line taxes before summing and preserves allocated cents', function (): void {
    $line = RoundingPolicy::currency('0.005');
    expect((string) $line)->toBe('0.01')
        ->and((string) $line->plus($line))->toBe('0.02')
        ->and(array_map(strval(...), RoundingPolicy::allocate('0.05', ['1', '1', '1'])))->toBe(['0.02', '0.02', '0.01']);
});
