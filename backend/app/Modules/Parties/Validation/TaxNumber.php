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
     * Comparison form for uniqueness and duplicate search: upper case without spaces, dots,
     * hyphens and slashes, so "DE 123.456-789" and "de123456789" are the same number.
     */
    public static function canonical(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $canonical = mb_strtoupper((string) preg_replace('/[\s.\-\/]+/u', '', $value));

        return $canonical === '' ? null : $canonical;
    }

    /**
     * @return string|null translation key of the failure, null when valid
     */
    public static function error(PartyType $type, string $country, string $value): ?string
    {
        if (strtoupper($country) !== 'TR') {
            return preg_match('/\A[\p{L}\p{N}\-\/. ]{1,'.self::MAX_FOREIGN_LENGTH.'}\z/u', $value) === 1
                ? null : 'parties::messages.invalid_foreign_tax_number';
        }

        return match ($type) {
            PartyType::Company => Vkn::isValid($value) ? null : 'parties::messages.invalid_vkn',
            PartyType::Person => Tckn::isValid($value) ? null : 'parties::messages.invalid_tckn',
        };
    }
}
