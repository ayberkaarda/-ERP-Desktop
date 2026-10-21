<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Organization\Models\Company;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\CostCenter;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\PaymentTerm;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Settings\Contracts\SettingsReader;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->root = User::factory()->superAdmin()->create();
});

function createCompany(User $root, string $code): string
{
    Identity::fresh();

    return test()->actingAs($root)->postJson('/api/v1/companies', ['code' => $code, 'name' => $code.' A.Ş.'], Identity::headers(idempotent: true))
        ->assertCreated()->json('data.id');
}

/** @return array<string, mixed> */
function companyDefaults(string $company): array
{
    return app(CompanyContext::class)->runAs($company, fn (): array => [
        'currencies' => CompanyCurrency::query()->where('is_active', true)->orderBy('currency_code')->pluck('currency_code')->all(),
        'base' => app(SettingsReader::class)->get('company.base_currency'),
        'terms' => PaymentTerm::query()->orderBy('due_days')->pluck('name', 'code')->all(),
        'due' => PaymentTerm::query()->orderBy('due_days')->pluck('due_days')->all(),
        'warehouses' => Warehouse::query()->get(['code', 'name', 'is_default'])->map(fn ($w): array => [$w->code, $w->name, $w->is_default])->all(),
        'locations' => Location::query()->pluck('code')->all(),
        'centers' => CostCenter::query()->get(['code', 'name', 'parent_id'])->map(fn ($c): array => [$c->code, $c->name, $c->parent_id])->all(),
        'units' => Unit::query()->orderBy('code')->pluck('name', 'code')->all(),
        'conversions' => UnitConversion::query()->with([])->get()->map(fn (UnitConversion $c): string => Unit::query()->whereKey($c->from_unit_id)->value('code').'>'.Unit::query()->whereKey($c->to_unit_id)->value('code').'='.$c->factor)->sort()->values()->all(),
    ]);
}

it('seeds currencies, payment terms, warehouse, cost center and units for a new company without global seeds', function (): void {
    expect(Currency::query()->count())->toBe(0);

    $id = createCompany($this->root, 'BOOT');
    $defaults = companyDefaults($id);

    expect($defaults['currencies'])->toBe(['EUR', 'GBP', 'TRY', 'USD'])
        ->and($defaults['base'])->toBe('TRY')
        ->and(Currency::query()->whereIn('code', ['TRY', 'USD', 'EUR', 'GBP'])->where('is_active', true)->count())->toBe(4)
        ->and($defaults['terms'])->toBe(['CASH' => 'Peşin', 'NET15' => '15 gün vadeli', 'NET30' => '30 gün vadeli', 'NET45' => '45 gün vadeli', 'NET60' => '60 gün vadeli', 'NET90' => '90 gün vadeli'])
        ->and($defaults['due'])->toBe([0, 15, 30, 45, 60, 90])
        ->and($defaults['warehouses'])->toBe([['MAIN', 'Ana depo', true]])
        ->and($defaults['locations'])->toBe(['DEFAULT'])
        ->and($defaults['centers'])->toBe([['GENERAL', 'Genel', null]])
        ->and(array_keys($defaults['units']))->toBe(['BOX', 'CM', 'DAY', 'G', 'HOUR', 'KG', 'LT', 'M', 'M2', 'M3', 'PACK', 'PCS'])
        ->and($defaults['units']['PCS'])->toBe('Adet')
        ->and($defaults['units']['M3'])->toBe('Metreküp')
        ->and($defaults['conversions'])->toBe(['DAY>HOUR=24.000000', 'KG>G=1000.000000', 'M>CM=100.000000']);

    // The currencies endpoint reports the activation for the company.
    $admin = Identity::member(Company::query()->findOrFail($id), ['Admin']);
    test()->actingAs($admin)->getJson('/api/v1/currencies?per_page=100', Identity::headers(Company::query()->findOrFail($id)))
        ->assertOk()->assertJsonPath('data.0.company_is_active', true);

    // Another company gets its own copy; the global currency rows are shared.
    $second = createCompany($this->root, 'BOOT2');
    expect(companyDefaults($second)['terms'])->toHaveCount(6)
        ->and(Currency::query()->count())->toBe(4);
});

it('is idempotent and leaves edited or deleted defaults alone', function (): void {
    $id = createCompany($this->root, 'IDEM');
    app(CompanyContext::class)->runAs($id, function (): void {
        PaymentTerm::query()->where('code', 'NET30')->firstOrFail()->fill(['name' => 'Renamed'])->save();
        Unit::query()->where('code', 'BOX')->firstOrFail()->delete();
    });
    $before = companyDefaults($id);

    CompanyCreated::dispatch($id, null, true);
    CompanyCreated::dispatch($id);

    $after = companyDefaults($id);
    expect($after)->toBe($before)
        ->and($after['terms']['NET30'])->toBe('Renamed')
        ->and($after['units'])->not->toHaveKey('BOX')
        ->and(app(CompanyContext::class)->runAs($id, fn () => Warehouse::query()->where('is_default', true)->count()))->toBe(1);
});

it('keeps an existing default warehouse as the default', function (): void {
    $company = Identity::company();
    app(CompanyContext::class)->runAs($company->id, fn () => Warehouse::factory()->create(['code' => 'OLD', 'is_default' => true]));

    CompanyCreated::dispatch($company->id);

    expect(app(CompanyContext::class)->runAs($company->id, fn () => Warehouse::query()->orderBy('code')->get()->map(fn ($w): array => [$w->code, $w->is_default])->all()))
        ->toBe([['MAIN', false], ['OLD', true]]);
});

it('creates nothing when the caller opts out', function (): void {
    $company = Identity::company();

    expect(companyDefaults($company->id))->toMatchArray(['currencies' => [], 'terms' => [], 'warehouses' => [], 'units' => [], 'centers' => []]);
});

it('rolls the company back when a bootstrap listener fails', function (): void {
    Event::listen(CompanyCreated::class, function (): never {
        throw new RuntimeException('bootstrap failed');
    });
    Identity::fresh();
    $this->withoutExceptionHandling();

    expect(fn () => test()->actingAs($this->root)->postJson('/api/v1/companies', ['code' => 'FAIL', 'name' => 'Fail'], Identity::headers(idempotent: true)))
        ->toThrow(RuntimeException::class, 'bootstrap failed');
    expect(Company::query()->where('code', 'FAIL')->exists())->toBeFalse()
        ->and(PaymentTerm::query()->withoutCompanyScope()->count())->toBe(0)
        ->and(Unit::query()->withoutCompanyScope()->count())->toBe(0);
});
