<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\ExchangeRate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Support\Actors;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->seed(ReferenceSeeder::class);
    $this->other = Actors::company();
    $this->company = Actors::company();
    $this->user = Actors::user(['exchange_rates.view', 'currencies.view']);
    Actors::grant($this->user, $this->other, ['exchange_rates.view', 'currencies.view']);
    $this->headers = ['X-Company-Id' => $this->company, 'Accept' => 'application/json'];
});

function listRates(array $query): array
{
    Identity::fresh();
    Sanctum::actingAs(test()->user);

    return test()->getJson('/api/v1/exchange-rates?'.http_build_query(['per_page' => 100, 'sort' => 'rate_date', ...$query]), test()->headers)
        ->assertOk()->json('data');
}

it('filters exchange rates by an inclusive date range over global and own manual rates', function (): void {
    foreach (['2026-10-01', '2026-10-05', '2026-10-10'] as $day) {
        ExchangeRate::factory()->create(['currency_code' => 'USD', 'rate_date' => $day, 'source' => 'tcmb']);
    }
    app(CompanyContext::class)->runAs($this->company, fn () => ExchangeRate::factory()->create(['currency_code' => 'EUR', 'rate_date' => '2026-10-05', 'source' => 'manual']));
    app(CompanyContext::class)->runAs($this->other, fn () => ExchangeRate::factory()->create(['currency_code' => 'GBP', 'rate_date' => '2026-10-05', 'source' => 'manual']));

    $rows = listRates(['filter' => ['date_from' => '2026-10-05', 'date_to' => '2026-10-10']]);
    expect(collect($rows)->map(fn (array $r): string => $r['currency_code'].'@'.substr($r['rate_date'], 0, 10).'/'.$r['source'])->sort()->values()->all())
        ->toBe(['EUR@2026-10-05/manual', 'USD@2026-10-05/tcmb', 'USD@2026-10-10/tcmb']);
    expect(listRates(['filter' => ['date_from' => '2026-10-06']]))->toHaveCount(1)
        ->and(listRates(['filter' => ['date_to' => '2026-10-01']]))->toHaveCount(1)
        // Combined with the column filters, which keep working.
        ->and(listRates(['filter' => ['date_from' => '2026-10-01', 'currency_code' => 'EUR']]))->toHaveCount(1)
        ->and(listRates(['filter' => ['rate_date' => '2026-10-05']]))->toHaveCount(2);

    Sanctum::actingAs($this->user);
    $this->getJson('/api/v1/exchange-rates?filter[date_from]=2026-10-10&filter[date_to]=2026-10-01', $this->headers)
        ->assertStatus(422)->assertJsonValidationErrors(['filter.date_to'], 'errors.fields');
    $this->getJson('/api/v1/exchange-rates?filter[date_from]=yesterday', $this->headers)
        ->assertStatus(422)->assertJsonValidationErrors(['filter.date_from'], 'errors.fields');
    // Range filters belong to exchange rates only.
    $this->getJson('/api/v1/currencies?filter[date_from]=2026-10-01', $this->headers)->assertStatus(422);
});

it('filters currencies by company activation without a query per row', function (): void {
    app(CompanyContext::class)->runAs($this->company, function (): void {
        CompanyCurrency::factory()->create(['currency_code' => 'TRY', 'is_active' => true]);
        CompanyCurrency::factory()->create(['currency_code' => 'USD', 'is_active' => true]);
        CompanyCurrency::factory()->create(['currency_code' => 'EUR', 'is_active' => false]);
    });
    app(CompanyContext::class)->runAs($this->other, fn () => CompanyCurrency::factory()->create(['currency_code' => 'GBP', 'is_active' => true]));
    Sanctum::actingAs($this->user);

    $active = $this->getJson('/api/v1/currencies?filter[company_active]=1&per_page=100&sort=code', $this->headers)->assertOk()->json('data');
    expect(array_column($active, 'code'))->toBe(['TRY', 'USD'])
        ->and(array_unique(array_column($active, 'company_is_active')))->toBe([true]);
    $inactive = $this->getJson('/api/v1/currencies?filter[company_active]=0&per_page=100', $this->headers)->assertOk()->json('data');
    expect(array_column($inactive, 'code'))->toContain('EUR', 'GBP', 'JPY')->not->toContain('TRY')
        ->and(collect($inactive)->firstWhere('code', 'EUR'))->toMatchArray(['company_is_active' => false, 'company_version' => 1])
        ->and(array_keys(collect($inactive)->first()))->not->toContain('company_activation_is_active');
    $this->getJson('/api/v1/currencies?filter[company_active]=maybe', $this->headers)->assertStatus(422)->assertJsonValidationErrors(['filter.company_active'], 'errors.fields');

    $queries = function (int $perPage): int {
        Identity::fresh();
        Sanctum::actingAs($this->user);
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson("/api/v1/currencies?per_page={$perPage}", $this->headers)->assertOk()->assertJsonCount($perPage, 'data');
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };
    expect($queries(20))->toBe($queries(2));
});
