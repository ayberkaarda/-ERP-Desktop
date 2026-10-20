<?php

declare(strict_types=1);

namespace App\Modules\Settings\Services;

use App\Modules\Settings\Contracts\SettingsRegistrar;
use App\Modules\Settings\Data\SettingDefinition;
use InvalidArgumentException;

final class SettingsRegistry implements SettingsRegistrar
{
    /** @var array<string, SettingDefinition> */
    private array $definitions = [];

    public function register(SettingDefinition $definition): void
    {
        $this->definitions[$definition->key] = $definition;
    }

    public function find(string $key): ?SettingDefinition
    {
        return $this->definitions[$key] ?? null;
    }

    public function findOrFail(string $key): SettingDefinition
    {
        return $this->find($key) ?? throw new InvalidArgumentException("Unknown setting [{$key}].");
    }

    /**
     * @return array<string, SettingDefinition>
     */
    public function all(): array
    {
        return $this->definitions;
    }
}
