<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Barcodes;

use InvalidArgumentException;

/**
 * GS1 mod-10 check digit shared by EAN-13, EAN-8 and UPC-A: digits are weighted 3,1,3,...
 * starting from the rightmost payload digit; the check digit tops the sum up to a multiple of 10.
 */
abstract class GtinValidator implements BarcodeValidator
{
    abstract public function length(): int;

    public function isValid(string $barcode): bool
    {
        // \A..\z: "$" would also match before a trailing newline.
        if (preg_match('/\A[0-9]{'.$this->length().'}\z/', $barcode) !== 1) {
            return false;
        }

        return self::checkDigit(substr($barcode, 0, -1)) === (int) substr($barcode, -1);
    }

    public static function checkDigit(string $payload): int
    {
        if (preg_match('/\A[0-9]+\z/', $payload) !== 1) {
            throw new InvalidArgumentException('The payload must contain digits only.');
        }

        $sum = 0;
        $digits = array_reverse(str_split($payload));

        foreach ($digits as $i => $digit) {
            $sum += (int) $digit * ($i % 2 === 0 ? 3 : 1);
        }

        return (10 - $sum % 10) % 10;
    }

    /** Appends the check digit to a payload of length() - 1 digits. */
    public function complete(string $payload): string
    {
        if (strlen($payload) !== $this->length() - 1) {
            throw new InvalidArgumentException('Unexpected payload length.');
        }

        return $payload.self::checkDigit($payload);
    }
}
