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
     * BBAN structure per country from the SWIFT IBAN registry (ISO 13616-2), Release 99
     * (December 2024), retrieved 2026-10-21 and cross-checked against two independent tables.
     * Single source of truth: contracts/iban-registry.json (a test fails on drift).
     * n = digits, a = upper case letters, c = upper case alphanumerics; adjacent parts of one
     * type are merged. The IBAN length is 4 + the sum of the parts.
     */
    private const array REGISTRY = [
        'AD' => '8n12c',
        'AE' => '19n',
        'AL' => '8n16c',
        'AT' => '16n',
        'AZ' => '4a20c',
        'BA' => '16n',
        'BE' => '12n',
        'BG' => '4a6n8c',
        'BH' => '4a14c',
        'BI' => '23n',
        'BR' => '23n1a1c',
        'BY' => '4c4n16c',
        'CH' => '5n12c',
        'CR' => '18n',
        'CY' => '8n16c',
        'CZ' => '20n',
        'DE' => '18n',
        'DJ' => '23n',
        'DK' => '14n',
        'DO' => '4c20n',
        'EE' => '16n',
        'EG' => '25n',
        'ES' => '20n',
        'FI' => '14n',
        'FK' => '2a12n',
        'FO' => '14n',
        'FR' => '10n11c2n',
        'GB' => '4a14n',
        'GE' => '2a16n',
        'GI' => '4a15c',
        'GL' => '14n',
        'GR' => '7n16c',
        'GT' => '24c',
        'HN' => '4a20n',
        'HR' => '17n',
        'HU' => '24n',
        'IE' => '4a14n',
        'IL' => '19n',
        'IQ' => '4a15n',
        'IS' => '22n',
        'IT' => '1a10n12c',
        'JO' => '4a4n18c',
        'KW' => '4a22c',
        'KZ' => '3n13c',
        'LB' => '4n20c',
        'LC' => '4a24c',
        'LI' => '5n12c',
        'LT' => '16n',
        'LU' => '3n13c',
        'LV' => '4a13c',
        'LY' => '21n',
        'MC' => '10n11c2n',
        'MD' => '20c',
        'ME' => '18n',
        'MK' => '3n10c2n',
        'MN' => '16n',
        'MR' => '23n',
        'MT' => '4a5n18c',
        'MU' => '4a19n3a',
        'NI' => '4a20n',
        'NL' => '4a10n',
        'NO' => '11n',
        'OM' => '3n16c',
        'PK' => '4a16c',
        'PL' => '24n',
        'PS' => '4a21c',
        'PT' => '21n',
        'QA' => '4a21c',
        'RO' => '4a16c',
        'RS' => '18n',
        'RU' => '14n15c',
        'SA' => '2n18c',
        'SC' => '4a20n3a',
        'SD' => '14n',
        'SE' => '20n',
        'SI' => '15n',
        'SK' => '20n',
        'SM' => '1a10n12c',
        'SO' => '19n',
        'ST' => '21n',
        'SV' => '4a20n',
        'TL' => '19n',
        'TN' => '20n',
        'TR' => '6n16c',
        'UA' => '6n19c',
        'VA' => '18n',
        'VG' => '4a16n',
        'XK' => '16n',
        'YE' => '4a4n18c',
    ];

    /**
     * @return array<string, string> country => BBAN structure
     */
    public static function registry(): array
    {
        return self::REGISTRY;
    }

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

        return $spec === null ? null : 4 + (int) array_sum(array_map('intval', self::parts($spec)));
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

    /**
     * @return list<string> parts such as "8n", "16c"
     */
    private static function parts(string $spec): array
    {
        preg_match_all('/\d+[nac]/', $spec, $m);

        return $m[0];
    }

    private static function bbanPattern(string $spec): string
    {
        $classes = ['n' => '[0-9]', 'a' => '[A-Z]', 'c' => '[A-Z0-9]'];
        $regex = '';

        foreach (self::parts($spec) as $part) {
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
