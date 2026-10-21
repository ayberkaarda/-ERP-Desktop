<?php

declare(strict_types=1);

use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Exceptions\RateNotFound;
use App\Modules\Reference\Models\ExchangeRate;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->seed(ReferenceSeeder::class);
});

it('converts through TRY using strings and manual precedence', function (): void {
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'forex_selling' => '35.000000', 'source' => 'tcmb']);
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'forex_selling' => '36.000000', 'source' => 'manual']);
    ExchangeRate::factory()->create(['currency_code' => 'EUR', 'forex_selling' => '40.000000']);
    $provider = app(ExchangeRateProvider::class);
    $date = new DateTimeImmutable('2026-10-20');
    expect($provider->rate('USD', 'TRY', $date))->toBe('36.000000')
        ->and($provider->rate('USD', 'EUR', $date))->toBe('0.900000')
        ->and($provider->rate('TRY', 'EUR', $date))->toBe('0.025000')
        ->and($provider->rate('TRY', 'TRY', $date))->toBe('1.000000');
});

it('includes the seventh earlier day but excludes the eighth', function (): void {
    ExchangeRate::factory()->create(['rate_date' => '2026-10-13']);
    $provider = app(ExchangeRateProvider::class);
    expect($provider->rate('USD', 'TRY', new DateTimeImmutable('2026-10-20')))->toBe('35.000000');
    expect(fn () => $provider->rate('USD', 'TRY', new DateTimeImmutable('2026-10-21')))->toThrow(RateNotFound::class);
});

it('does not combine two legs from different dates or accept unknown currencies', function (): void {
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => '2026-10-20']);
    ExchangeRate::factory()->create(['currency_code' => 'EUR', 'rate_date' => '2026-10-19']);
    $provider = app(ExchangeRateProvider::class);
    expect(fn () => $provider->rate('USD', 'EUR', new DateTimeImmutable('2026-10-20')))->toThrow(RateNotFound::class);
    expect(fn () => $provider->rate('XXX', 'XXX', new DateTimeImmutable('2026-10-20')))->toThrow(RateNotFound::class);
});
