<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Exceptions\RateNotFound;
use App\Modules\Reference\Models\ExchangeRate;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->seed(ReferenceSeeder::class);
});

/** @param array<string, mixed> $attributes */
function manualRate(string $company, array $attributes): ExchangeRate
{
    return app(CompanyContext::class)->runAs($company, fn () => ExchangeRate::factory()->create(['source' => 'manual', ...$attributes]));
}

it('converts through TRY using strings and manual precedence', function (): void {
    $company = Actors::company();
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'forex_selling' => '35.000000']);
    manualRate($company, ['currency_code' => 'USD', 'forex_selling' => '36.000000']);
    ExchangeRate::factory()->create(['currency_code' => 'EUR', 'forex_selling' => '40.000000']);
    Actors::activate($company);
    $provider = app(ExchangeRateProvider::class);
    $date = new DateTimeImmutable('2026-10-20');
    expect($provider->rate('USD', 'TRY', $date))->toBe('36.000000')
        ->and($provider->rate('USD', 'EUR', $date))->toBe('0.900000')
        ->and($provider->rate('TRY', 'EUR', $date))->toBe('0.025000')
        ->and($provider->rate('TRY', 'TRY', $date))->toBe('1.000000');
});

it('never applies or shows another company manual rate', function (): void {
    [$a, $b] = [Actors::company(), Actors::company()];
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'forex_selling' => '35.000000']);
    $foreign = manualRate($a, ['currency_code' => 'USD', 'forex_selling' => '99.000000']);
    manualRate($a, ['currency_code' => 'EUR', 'forex_selling' => '50.000000']);
    $date = new DateTimeImmutable('2026-10-20');
    $provider = app(ExchangeRateProvider::class);
    $context = app(CompanyContext::class);
    expect($context->runAs($b, fn () => $provider->rate('USD', 'TRY', $date)))->toBe('35.000000')
        ->and($context->runAs($a, fn () => $provider->rate('USD', 'TRY', $date)))->toBe('99.000000')
        ->and($provider->rate('USD', 'TRY', $date))->toBe('35.000000');
    expect(fn () => $context->runAs($b, fn () => $provider->rate('EUR', 'TRY', $date)))->toThrow(RateNotFound::class);

    Sanctum::actingAs(Actors::user(['exchange_rates.view'], $b));
    $headers = ['X-Company-Id' => $b];
    $this->getJson('/api/v1/exchange-rates', $headers)->assertOk()->assertJsonPath('meta.pagination.total', 1)
        ->assertJsonPath('data.0.source', 'tcmb');
    $this->getJson('/api/v1/exchange-rates/'.$foreign->id, $headers)->assertNotFound();
    $this->travelTo(now()->setDate(2026, 10, 21));
    $this->getJson('/api/v1/exchange-rates/latest?currency=USD', $headers)->assertOk()->assertJsonPath('data.forex_selling', '35.000000');
    $this->getJson('/api/v1/exchange-rates/latest?currency=EUR', $headers)->assertNotFound();
});

it('prefers the company manual rate only on the same fixing date', function (): void {
    $company = Actors::company();
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => '2026-10-20', 'forex_selling' => '35.000000']);
    manualRate($company, ['currency_code' => 'USD', 'rate_date' => '2026-10-19', 'forex_selling' => '36.000000']);
    ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => '2026-10-19', 'forex_selling' => '37.000000']);
    Actors::activate($company);
    $provider = app(ExchangeRateProvider::class);
    // The most recent fixing date wins; manual precedence applies within that date only.
    expect($provider->rate('USD', 'TRY', new DateTimeImmutable('2026-10-20')))->toBe('35.000000')
        ->and($provider->rate('USD', 'TRY', new DateTimeImmutable('2026-10-22')))->toBe('35.000000')
        ->and($provider->rate('USD', 'TRY', new DateTimeImmutable('2026-10-19')))->toBe('36.000000');
    expect(fn () => $provider->rate('USD', 'TRY', new DateTimeImmutable('2026-10-18')))->toThrow(RateNotFound::class);
});

it('enforces rate ownership and per-source unique days in the database', function (): void {
    [$a, $b] = [Actors::company(), Actors::company()];
    ExchangeRate::factory()->create();
    manualRate($a, []);
    manualRate($b, []);
    expect(ExchangeRate::query()->withoutGlobalScope('visible')->count())->toBe(3);
    $insert = fn (array $row) => DB::transaction(fn () => DB::table('exchange_rates')->insert([
        'id' => (string) Str::uuid7(), 'currency_code' => 'USD', 'rate_date' => '2026-10-20', 'forex_selling' => '1',
        'created_at' => now(), 'updated_at' => now(), ...$row,
    ]));
    expect(fn () => $insert(['source' => 'tcmb']))->toThrow(QueryException::class)
        ->and(fn () => $insert(['source' => 'manual', 'company_id' => $a]))->toThrow(QueryException::class)
        ->and(fn () => $insert(['source' => 'tcmb', 'company_id' => $a, 'rate_date' => '2026-10-19']))->toThrow(QueryException::class)
        ->and(fn () => $insert(['source' => 'manual', 'rate_date' => '2026-10-19']))->toThrow(QueryException::class);
    $insert(['source' => 'tcmb', 'rate_date' => '2026-10-19']);
    expect(fn () => app(CompanyContext::class)->runAs($a, fn () => ExchangeRate::factory()->create(['source' => 'manual', 'company_id' => $b, 'rate_date' => '2026-10-18'])))
        ->toThrow(ApiException::class)
        ->and(fn () => app(CompanyContext::class)->runAs($a, fn () => ExchangeRate::factory()->create(['company_id' => $a, 'rate_date' => '2026-10-18'])))
        ->toThrow(ApiException::class);
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
