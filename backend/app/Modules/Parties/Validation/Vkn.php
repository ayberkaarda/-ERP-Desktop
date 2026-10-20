<?php

declare(strict_types=1);

namespace App\Modules\Parties\Validation;

/**
 * Turkish tax identification number (Vergi Kimlik Numarası): 10 digits, the last one a check digit.
 *
 * For each of the first nine digits d (position i = 1..9): t = (d + 10 - i) mod 10;
 * the term is 9 when t = 9, otherwise (t * 2^(10 - i)) mod 9. The check digit is
 * (10 - (sum mod 10)) mod 10.
 */
final class Vkn
{
    public static function isValid(string $value): bool
    {
        if (preg_match('/^\d{10}$/', $value) !== 1) {
            return false;
        }

        return self::checkDigit(substr($value, 0, 9)) === (int) $value[9];
    }

    /**
     * @param  string  $first9  the first nine digits
     */
    public static function checkDigit(string $first9): int
    {
        if (preg_match('/^\d{9}$/', $first9) !== 1) {
            throw new \InvalidArgumentException('Nine digits expected.');
        }

        $sum = 0;

        for ($i = 1; $i <= 9; $i++) {
            $t = ((int) $first9[$i - 1] + 10 - $i) % 10;
            $sum += $t === 9 ? 9 : ($t * (2 ** (10 - $i))) % 9;
        }

        return (10 - ($sum % 10)) % 10;
    }
}
