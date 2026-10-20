<?php

declare(strict_types=1);

namespace App\Modules\Settings\Contracts;

use App\Modules\Settings\Data\SettingDefinition;

/**
 * Lets other modules declare their company settings from a service provider.
 */
interface SettingsRegistrar
{
    public function register(SettingDefinition $definition): void;
}
