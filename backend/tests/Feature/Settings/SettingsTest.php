<?php

declare(strict_types=1);

use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Enums\SettingType;
use App\Modules\Settings\Models\Setting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\Support\Svc\SvcActors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    SvcActors::install();
    $this->company = SvcActors::company();
    $this->admin = SvcActors::user(['settings.view', 'settings.update']);

    $this->api = fn ($user = null, ?string $company = null) => tap($this, fn () => Auth::forgetGuards())
        ->actingAs($user ?? $this->admin, 'web')
        ->withHeader('X-Company-Id', $company ?? $this->company);
});

it('lists registry defaults', function (): void {
    ($this->api)()->getJson('/api/v1/settings')
        ->assertOk()
        ->assertJsonFragment(['key' => 'general.default_locale', 'value' => 'tr', 'is_default' => true, 'type' => 'enum'])
        ->assertJsonFragment(['key' => 'security.session_timeout_minutes', 'value' => 120]);
});

it('localizes labels', function (): void {
    app()->setLocale('de');

    ($this->api)()->getJson('/api/v1/settings?group=general')
        ->assertOk()
        ->assertJsonFragment(['label' => 'Zeitzone'])
        ->assertJsonMissing(['key' => 'security.require_two_factor']);
});

it('requires authentication, a company and permissions', function (): void {
    $this->getJson('/api/v1/settings')->assertUnauthorized();

    $this->actingAs($this->admin, 'web')->getJson('/api/v1/settings')
        ->assertStatus(400)->assertJsonPath('errors.code', 'COMPANY_REQUIRED');

    $nobody = SvcActors::user();
    ($this->api)($nobody)->getJson('/api/v1/settings')->assertForbidden();
    ($this->api)($nobody)->patchJson('/api/v1/settings', ['settings' => ['general.timezone' => 'UTC']])->assertForbidden();

    $viewer = SvcActors::user(['settings.view']);
    ($this->api)($viewer)->getJson('/api/v1/settings')->assertOk();
    ($this->api)($viewer)->patchJson('/api/v1/settings', ['settings' => ['general.timezone' => 'UTC']])->assertForbidden();
});

it('updates typed values and records the editor', function (): void {
    ($this->api)()->patchJson('/api/v1/settings', ['settings' => [
        'general.default_locale' => 'en',
        'security.session_timeout_minutes' => '30',
        'security.require_two_factor' => true,
    ]])
        ->assertOk()
        ->assertJsonFragment(['key' => 'general.default_locale', 'value' => 'en', 'is_default' => false])
        ->assertJsonFragment(['key' => 'security.session_timeout_minutes', 'value' => 30]);

    $row = Setting::query()->withoutGlobalScopes()->where('key', 'security.session_timeout_minutes')->firstOrFail();
    expect($row->value)->toBe(30)
        ->and($row->updated_by)->toBe($this->admin->id)
        ->and($row->company_id)->toBe($this->company);
});

it('validates values per type and rule', function (): void {
    ($this->api)()->patchJson('/api/v1/settings', ['settings' => [
        'general.default_locale' => 'xx',
        'security.session_timeout_minutes' => 1,
        'security.require_two_factor' => 'maybe',
        'general.timezone' => 'Mars/Base',
        'nope.key' => 'x',
    ]])
        ->assertStatus(422)
        ->assertJsonPath('errors.code', 'VALIDATION_ERROR')
        ->assertJsonStructure(['errors' => ['fields' => [
            'settings.general.default_locale', 'settings.security.session_timeout_minutes',
            'settings.security.require_two_factor', 'settings.general.timezone', 'settings.nope.key',
        ]]]);

    expect(Setting::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('rejects an empty or malformed payload', function (): void {
    ($this->api)()->patchJson('/api/v1/settings', [])->assertStatus(422);
    ($this->api)()->patchJson('/api/v1/settings', ['settings' => 'x'])->assertStatus(422);
});

it('resets a key to its default with null', function (): void {
    ($this->api)()->patchJson('/api/v1/settings', ['settings' => ['general.default_locale' => 'en']])->assertOk();
    ($this->api)()->patchJson('/api/v1/settings', ['settings' => ['general.default_locale' => null]])
        ->assertOk()
        ->assertJsonFragment(['key' => 'general.default_locale', 'value' => 'tr', 'is_default' => true]);
});

it('isolates companies', function (): void {
    ($this->api)()->patchJson('/api/v1/settings', ['settings' => ['general.default_locale' => 'en']])->assertOk();

    ($this->api)(null, SvcActors::company())->getJson('/api/v1/settings')
        ->assertJsonFragment(['key' => 'general.default_locale', 'value' => 'tr']);
});

it('serves from cache and invalidates on every write path', function (): void {
    ($this->api)()->getJson('/api/v1/settings')->assertOk();
    expect(Cache::has("settings:{$this->company}"))->toBeTrue();

    ($this->api)()->patchJson('/api/v1/settings', ['settings' => ['general.default_locale' => 'fr']])->assertOk();
    $reader = app(SettingsReader::class);
    expect($reader->get('general.default_locale'))->toBe('fr');

    // A write that bypasses the service still drops the cache.
    SvcActors::activate($this->company);
    Setting::query()->where('key', 'general.default_locale')->firstOrFail()->update(['value' => 'de']);
    expect(app(SettingsReader::class)->get('general.default_locale'))->toBe('de');
});

it('lets modules register settings with their own permissions', function (): void {
    app(SettingsRegistrar::class)->register(new SettingDefinition(
        'accounting.lock_day', SettingType::Int, 5, 'accounting', rules: ['between:1,28'], updatePermission: 'accounting.settings.update',
    ));
    app(SettingsRegistrar::class)->register(new SettingDefinition(
        'accounting.hidden', SettingType::Json, [], 'accounting', readPermission: 'accounting.settings.update',
    ));

    ($this->api)()->getJson('/api/v1/settings')
        ->assertJsonFragment(['key' => 'accounting.lock_day'])
        ->assertJsonMissing(['key' => 'accounting.hidden']);

    ($this->api)()->patchJson('/api/v1/settings', ['settings' => ['accounting.lock_day' => 10]])->assertForbidden();

    $accountant = SvcActors::user(['settings.view', 'settings.update', 'accounting.settings.update']);
    ($this->api)($accountant)->patchJson('/api/v1/settings', ['settings' => ['accounting.lock_day' => 10, 'accounting.hidden' => ['a' => 1]]])
        ->assertOk()
        ->assertJsonFragment(['key' => 'accounting.lock_day', 'value' => 10])
        ->assertJsonFragment(['key' => 'accounting.hidden', 'value' => ['a' => 1]]);

    ($this->api)($accountant)->patchJson('/api/v1/settings', ['settings' => ['accounting.lock_day' => 40]])->assertStatus(422);
});
