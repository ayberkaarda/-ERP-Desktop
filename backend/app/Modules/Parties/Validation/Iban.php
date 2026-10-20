<?php

declare(strict_types=1);

namespace App\Modules\Parties\Validation;

/**
 * ISO 13616 IBAN: structure, per-country length (for the countries listed), check digits 02..98
 * and the ISO 7064 mod 97-10 checksum. Turkish IBANs must also match the TR BBAN layout:
 * 5-digit bank code, reserve digit 0, 16 alphanumeric account characters (26 in total).
 */
final class Iban
{
    /** Registry lengths; countries not listed only get the generic 15..34 bound. */
    private const array LENGTHS = [
        'AD' => 24, 'AE' => 23, 'AL' => 28, 'AT' => 20, 'AZ' => 28, 'BA' => 20, 'BE' => 16, 'BG' => 22,
        'BH' => 22, 'BR' => 29, 'CH' => 21, 'CR' => 22, 'CY' => 28, 'CZ' => 24, 'DE' => 22, 'DK' => 18,
        'DO' => 28, 'EE' => 20, 'ES' => 24, 'FI' => 18, 'FO' => 18, 'FR' => 27, 'GB' => 22, 'GE' => 22,
        'GI' => 23, 'GL' => 18, 'GR' => 27, 'GT' => 28, 'HR' => 21, 'HU' => 28, 'IE' => 22, 'IL' => 23,
        'IS' => 26, 'IT' => 27, 'JO' => 30, 'KW' => 30, 'KZ' => 20, 'LB' => 28, 'LI' => 21, 'LT' => 20,
        'LU' => 20, 'LV' => 21, 'MC' => 27, 'MD' => 24, 'ME' => 22, 'MK' => 19, 'MR' => 27, 'MT' => 31,
        'MU' => 30, 'NL' => 18, 'NO' => 15, 'PK' => 24, 'PL' => 28, 'PS' => 29, 'PT' => 25, 'QA' => 29,
        'RO' => 24, 'RS' => 22, 'SA' => 24, 'SE' => 24, 'SI' => 19, 'SK' => 24, 'SM' => 27, 'TN' => 24,
        'TR' => 26, 'UA' => 29, 'VG' => 24, 'XK' => 20,
    ];

    /**
     * Electronic format: no spaces, upper case.
     */
    public static function normalize(string $value): string
    {
        return strtoupper((string) preg_replace('/\s+/', '', $value));
    }

    public static function isValid(string $value): bool
    {
        $iban = self::normalize($value);

        if (preg_match('/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/', $iban) !== 1) {
            return false;
        }

        $country = substr($iban, 0, 2);

        if (isset(self::LENGTHS[$country]) && strlen($iban) !== self::LENGTHS[$country]) {
            return false;
        }

        if ($country === 'TR' && preg_match('/^TR\d{2}\d{5}0[A-Z0-9]{16}$/', $iban) !== 1) {
            return false;
        }

        // 00, 01 and 99 can satisfy mod 97 by congruence but are never issued.
        $check = (int) substr($iban, 2, 2);

        if ($check < 2 || $check > 98) {
            return false;
        }

        return self::mod97(substr($iban, 4).substr($iban, 0, 4)) === 1;
    }

    public static function country(string $value): string
    {
        return substr(self::normalize($value), 0, 2);
    }

    /**
     * Letters become 10..35; the remainder is folded digit by digit to stay within int range.
     */
    private static function mod97(string $rearranged): int
    {
        $remainder = 0;

        foreach (str_split($rearranged) as $char) {
            $digits = ctype_alpha($char) ? (string) (ord($char) - 55) : $char;

            foreach (str_split($digits) as $digit) {
                $remainder = ($remainder * 10 + (int) $digit) % 97;
            }
        }

        return $remainder;
    }
}
