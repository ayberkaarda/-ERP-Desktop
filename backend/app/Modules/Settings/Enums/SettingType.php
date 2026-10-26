<?php

declare(strict_types=1);

namespace App\Modules\Settings\Enums;

enum SettingType: string
{
    case String = 'string';
    case Int = 'int';
    case Bool = 'bool';
    case Json = 'json';
    case Enum = 'enum';

    /**
     * Baseline rules implied by the type, before the definition's own rules.
     *
     * @param  list<string>  $options
     * @return list<string>
     */
    public function rules(array $options): array
    {
        return match ($this) {
            self::String => ['string', 'max:5000'],
            self::Int => ['integer'],
            self::Bool => ['boolean'],
            self::Json => ['array'],
            self::Enum => ['string', 'in:'.implode(',', $options)],
        };
    }

    public function cast(mixed $value): mixed
    {
        return match ($this) {
            self::Int => is_numeric($value) ? (int) $value : $value,
            self::Bool => filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $value,
            default => $value,
        };
    }
}
