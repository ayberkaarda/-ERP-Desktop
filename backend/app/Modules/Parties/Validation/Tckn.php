<?php

declare(strict_types=1);

namespace App\Modules\Parties\Validation;

/**
 * Turkish national identity number (T.C. Kimlik No): 11 digits, first digit not zero.
 *
 * d10 = ((d1 + d3 + d5 + d7 + d9) * 7 - (d2 + d4 + d6 + d8)) mod 10 (non-negative modulo),
 * d11 = (d1 + ... + d10) mod 10.
 */
final class Tckn
{
    public static function isValid(string $value): bool
    {
        if (preg_match('/^[1-9]\d{10}$/', $value) !== 1) {
            return false;
        }

        return substr($value, 9, 2) === self::checkDigits(substr($value, 0, 9));
    }

    /**
     * @param  string  $first9  the first nine digits (first not zero)
     * @return string the two check digits
     */
    public static function checkDigits(string $first9): string
    {
        if (preg_match('/^[1-9]\d{8}$/', $first9) !== 1) {
            throw new \InvalidArgumentException('Nine digits not starting with zero expected.');
        }

        $d = array_map('intval', str_split($first9));
        $odd = $d[0] + $d[2] + $d[4] + $d[6] + $d[8];
        $even = $d[1] + $d[3] + $d[5] + $d[7];
        $tenth = ((($odd * 7 - $even) % 10) + 10) % 10;
        $eleventh = (array_sum($d) + $tenth) % 10;

        return $tenth.$eleventh;
    }
}
