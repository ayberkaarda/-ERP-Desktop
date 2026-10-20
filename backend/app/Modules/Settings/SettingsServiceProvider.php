<?php

declare(strict_types=1);

namespace App\Modules\Settings;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Settings\Contracts\SettingsReader;
use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use App\Modules\Settings\Enums\SettingType;
use App\Modules\Settings\Models\Setting;
use App\Modules\Settings\Policies\SettingPolicy;
use App\Modules\Settings\Services\SettingsRegistry;
use App\Modules\Settings\Services\SettingsService;
use Illuminate\Support\Facades\Gate;

final class SettingsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SettingsRegistry::class);
        $this->app->bind(SettingsRegistrar::class, SettingsRegistry::class);
        $this->app->bind(SettingsReader::class, SettingsService::class);
    }

    public function boot(): void
    {
        parent::boot();

        Gate::policy(Setting::class, SettingPolicy::class);

        $this->registerBuiltIns($this->app->make(SettingsRegistry::class));
    }

    private function registerBuiltIns(SettingsRegistry $registry): void
    {
        $registry->register(new SettingDefinition('general.default_locale', SettingType::Enum, 'tr', 'general', options: ['tr', 'en', 'de', 'fr']));
        $registry->register(new SettingDefinition('general.timezone', SettingType::String, 'Europe/Istanbul', 'general', rules: ['timezone:all']));
        $registry->register(new SettingDefinition('general.date_format', SettingType::Enum, 'dd.MM.yyyy', 'general', options: ['dd.MM.yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy']));
        $registry->register(new SettingDefinition('security.session_timeout_minutes', SettingType::Int, 120, 'security', rules: ['min:5', 'max:1440']));
        $registry->register(new SettingDefinition('security.require_two_factor', SettingType::Bool, false, 'security'));
        $registry->register(new SettingDefinition('notifications.email_enabled', SettingType::Bool, true, 'notifications'));
    }
}
