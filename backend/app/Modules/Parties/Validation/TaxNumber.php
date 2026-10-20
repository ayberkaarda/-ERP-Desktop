<?php

declare(strict_types=1);

namespace App\Modules\Parties\Validation;

use App\Modules\Parties\Enums\PartyType;

/**
 * Which tax number a party needs: Turkish companies a VKN, Turkish persons a TCKN;
 * parties outside TR may use any identifier (only length and charset are limited).
 */
final class TaxNumber
{
    public const int MAX_FOREIGN_LENGTH = 32;

    /**
     * Turkish numbers lose separators; foreign ones are only trimmed.
     */
    public static function normalize(string $value, string $country): string
    {
        $value = trim($value);

        return strtoupper($country) === 'TR' ? (string) preg_replace('/[\s.\-]+/', '', $value) : $value;
    }

    /**
     * @return string|null translation key of the failure, null when valid
     */
    public static function error(PartyType $type, string $country, string $value): ?string
    {
        if (strtoupper($country) !== 'TR') {
            return preg_match('/^[\p{L}\p{N}\-\/. ]{1,'.self::MAX_FOREIGN_LENGTH.'}$/u', $value) === 1
                ? null : 'parties::messages.invalid_foreign_tax_number';
        }

        return match ($type) {
            PartyType::Company => Vkn::isValid($value) ? null : 'parties::messages.invalid_vkn',
            PartyType::Person => Tckn::isValid($value) ? null : 'parties::messages.invalid_tckn',
        };
    }
}
