<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\TaxCode;
use App\Modules\Settings\Services\SettingsRegistry;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;

uses(RefreshDatabase::class);

it('seeds global reference data from DatabaseSeeder and can run again without changes', function (): void {
    putenv('ADMIN_EMAIL=root@example.test');
    putenv('ADMIN_PASSWORD=Correct-Horse-Battery-9-Staple');

    try {
        $this->seed(DatabaseSeeder::class);
        $counts = [Currency::query()->count(), TaxCode::query()->withoutGlobalScope('visible')->count(), User::query()->count()];
        Currency::query()->where('code', 'JPY')->firstOrFail()->fill(['name' => 'Edited'])->save();

        $this->seed(DatabaseSeeder::class);
    } finally {
        putenv('ADMIN_EMAIL');
        putenv('ADMIN_PASSWORD');
    }

    expect($counts[0])->toBeGreaterThanOrEqual(22)
        ->and(TaxCode::query()->withoutGlobalScope('visible')->where('code', 'VAT20')->exists())->toBeTrue()
        ->and([Currency::query()->count(), TaxCode::query()->withoutGlobalScope('visible')->count(), User::query()->count()])->toBe($counts)
        ->and(Currency::query()->where('code', 'JPY')->value('name'))->toBe('Edited');
});

it('lists the daily TCMB import in schedule:list', function (): void {
    Artisan::call('schedule:list', ['--timezone' => 'Europe/Istanbul']);
    $line = collect(explode("\n", Artisan::output()))->first(fn (string $l): bool => str_contains($l, 'rates:fetch-tcmb'));

    expect($line)->not->toBeNull()
        ->and($line)->toContain('0 16 * * *');
});

it('labels every registered setting, including company.base_currency, in all four locales', function (): void {
    $keys = array_map(fn ($definition): string => $definition->key, app(SettingsRegistry::class)->all());
    expect($keys)->toContain('company.base_currency');

    foreach (['tr', 'en', 'de', 'fr'] as $locale) {
        foreach ($keys as $key) {
            expect(trans()->hasForLocale('settings::registry.'.$key, $locale))->toBeTrue("{$locale}: {$key}");
        }
    }
    expect(__('settings::registry.company.base_currency', [], 'tr'))->toBe('Ana para birimi');
});
