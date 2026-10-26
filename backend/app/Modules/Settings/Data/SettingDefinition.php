<?php

declare(strict_types=1);

namespace App\Modules\Settings\Data;

use App\Modules\Settings\Enums\SettingType;
use InvalidArgumentException;

final readonly class SettingDefinition
{
    public const string DEFAULT_READ = 'settings.view';

    public const string DEFAULT_UPDATE = 'settings.update';

    /**
     * @param  list<string|object>  $rules  extra validation rules applied after the type rules
     * @param  list<string>  $options  allowed values for enum settings
     * @param  string|null  $readPermission  extra permission on top of settings.view
     * @param  string|null  $updatePermission  extra permission on top of settings.update
     * @param  bool  $sensitive  values are redacted in the audit trail
     */
    public function __construct(
        public string $key,
        public SettingType $type,
        public mixed $default,
        public string $group,
        public array $rules = [],
        public array $options = [],
        public ?string $readPermission = null,
        public ?string $updatePermission = null,
        public bool $sensitive = false,
    ) {
        if ($type === SettingType::Enum && $options === []) {
            throw new InvalidArgumentException("Enum setting [{$key}] needs options.");
        }
    }

    /**
     * @return list<string|object>
     */
    public function validationRules(): array
    {
        return [...$this->type->rules($this->options), ...$this->rules];
    }
}
