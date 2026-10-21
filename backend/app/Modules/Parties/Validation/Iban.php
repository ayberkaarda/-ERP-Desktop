<?php

declare(strict_types=1);

namespace App\Modules\Parties\Validation;

/**
 * ISO 13616 IBAN checked against the SWIFT IBAN registry: known country, exact length, BBAN
 * character pattern, check digits 02..98 and the ISO 7064 mod 97-10 checksum. Countries missing
 * from the registry table are rejected. Turkey additionally requires the reserve digit 0.
 */
final class Iban
{
    /**
     * BBAN structure per country in registry notation: n = digits, a = upper case letters,
     * c = upper case alphanumerics. The IBAN length is 4 + the sum of the parts.
     */
    private const array REGISTRY = [
        'AD' => '4n,4n,12c', 'AE' => '3n,16n', 'AL' => '8n,16c', 'AT' => '5n,11n', 'AZ' => '4a,20c',
        'BA' => '3n,3n,8n,2n', 'BE' => '3n,7n,2n', 'BG' => '4a,4n,2n,8c', 'BH' => '4a,14c',
        'BR' => '8n,5n,10n,1a,1c', 'BY' => '4c,4n,16c', 'CH' => '5n,12c', 'CR' => '4n,14n',
        'CY' => '3n,5n,16c', 'CZ' => '4n,6n,10n', 'DE' => '8n,10n', 'DK' => '4n,9n,1n', 'DO' => '4c,20n',
        'EE' => '2n,2n,11n,1n', 'EG' => '4n,4n,17n', 'ES' => '4n,4n,1n,1n,10n', 'FI' => '3n,11n',
        'FO' => '4n,9n,1n', 'FR' => '5n,5n,11c,2n', 'GB' => '4a,6n,8n', 'GE' => '2a,16n', 'GI' => '4a,15c',
        'GL' => '4n,9n,1n', 'GR' => '3n,4n,16c', 'GT' => '4c,20c', 'HR' => '7n,10n',
        'HU' => '3n,4n,1n,15n,1n', 'IE' => '4a,6n,8n', 'IL' => '3n,3n,13n', 'IQ' => '4a,3n,12n',
        'IS' => '4n,2n,6n,10n', 'IT' => '1a,5n,5n,12c', 'JO' => '4a,4n,18c', 'KW' => '4a,22c',
        'KZ' => '3n,13c', 'LB' => '4n,20c', 'LC' => '4a,24c', 'LI' => '5n,12c', 'LT' => '5n,11n',
        'LU' => '3n,13c', 'LV' => '4a,13c', 'MC' => '5n,5n,11c,2n', 'MD' => '2c,18c', 'ME' => '3n,13n,2n',
        'MK' => '3n,10c,2n', 'MR' => '5n,5n,11n,2n', 'MT' => '4a,5n,18c', 'MU' => '4a,2n,2n,12n,3n,3a',
        'NL' => '4a,10n', 'NO' => '4n,6n,1n', 'PK' => '4a,16c', 'PL' => '8n,16n', 'PS' => '4a,21c',
        'PT' => '4n,4n,11n,2n', 'QA' => '4a,21c', 'RO' => '4a,16c', 'RS' => '3n,13n,2n', 'SA' => '2n,18c',
        'SC' => '4a,2n,2n,16n,3a', 'SE' => '3n,16n,1n', 'SI' => '5n,8n,2n', 'SK' => '4n,6n,10n',
        'SM' => '1a,5n,5n,12c', 'ST' => '8n,11n,2n', 'SV' => '4a,20n', 'TL' => '3n,14n,2n',
        'TN' => '2n,3n,13n,2n', 'TR' => '5n,1n,16c', 'UA' => '6n,19c', 'VA' => '3n,15n', 'VG' => '4a,16n',
        'XK' => '4n,10n,2n',
    ];

    /**
     * Electronic format: no whitespace, upper case.
     */
    public static function normalize(string $value): string
    {
        return strtoupper((string) preg_replace('/\s+/', '', $value));
    }

    public static function isValid(string $value): bool
    {
        $iban = self::normalize($value);

        if (preg_match('/\A([A-Z]{2})(\d{2})([A-Z0-9]+)\z/', $iban, $m) !== 1 || ! isset(self::REGISTRY[$m[1]])) {
            return false;
        }

        if (preg_match(self::bbanPattern(self::REGISTRY[$m[1]]), $m[3]) !== 1) {
            return false;
        }

        if ($m[1] === 'TR' && $m[3][5] !== '0') {
            return false;
        }

        // 00, 01 and 99 can satisfy mod 97 by congruence but are never issued.
        $check = (int) $m[2];

        if ($check < 2 || $check > 98) {
            return false;
        }

        return self::mod97($m[3].$m[1].$m[2]) === 1;
    }

    public static function length(string $country): ?int
    {
        $spec = self::REGISTRY[strtoupper($country)] ?? null;

        return $spec === null ? null : 4 + array_sum(array_map('intval', explode(',', $spec)));
    }

    public static function country(string $value): string
    {
        return substr(self::normalize($value), 0, 2);
    }

    /**
     * Country code and last four characters only, for logs and other low-trust output.
     */
    public static function mask(string $value): string
    {
        $iban = self::normalize($value);
        $length = strlen($iban);

        if ($length <= 6) {
            return str_repeat('*', $length);
        }

        return substr($iban, 0, 2).str_repeat('*', $length - 6).substr($iban, -4);
    }

    private static function bbanPattern(string $spec): string
    {
        $classes = ['n' => '[0-9]', 'a' => '[A-Z]', 'c' => '[A-Z0-9]'];
        $regex = '';

        foreach (explode(',', $spec) as $part) {
            $regex .= $classes[substr($part, -1)].'{'.(int) $part.'}';
        }

        return '/\A'.$regex.'\z/';
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
