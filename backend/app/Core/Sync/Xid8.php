<?php

declare(strict_types=1);

namespace App\Core\Sync;

use InvalidArgumentException;
use JsonSerializable;
use OverflowException;
use Stringable;

/**
 * PostgreSQL xid8 (64-bit, unsigned) as a canonical decimal string. PHP ints are signed and
 * JSON numbers lose precision past 2^53, so the value never leaves this form; comparison is
 * by length, then lexically.
 */
final readonly class Xid8 implements JsonSerializable, Stringable
{
    public const string MAX = '18446744073709551615';

    private const string PATTERN = '/\A(0|[1-9][0-9]{0,19})\z/';

    private function __construct(public string $value) {}

    public static function of(string|int $value): self
    {
        $value = (string) $value;

        if (! self::isValid($value)) {
            throw new InvalidArgumentException("Invalid xid8 value [{$value}].");
        }

        return new self($value);
    }

    public static function tryOf(mixed $value): ?self
    {
        if (is_int($value) && $value >= 0) {
            $value = (string) $value;
        }

        return is_string($value) && self::isValid($value) ? new self($value) : null;
    }

    public static function zero(): self
    {
        return new self('0');
    }

    public static function isValid(string $value): bool
    {
        return preg_match(self::PATTERN, $value) === 1
            && (strlen($value) < strlen(self::MAX) || strcmp($value, self::MAX) <= 0);
    }

    /**
     * @return int -1, 0 or 1
     */
    public function compare(self $other): int
    {
        $byLength = strlen($this->value) <=> strlen($other->value);

        return $byLength !== 0 ? $byLength : strcmp($this->value, $other->value) <=> 0;
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }

    public function lessThan(self $other): bool
    {
        return $this->compare($other) < 0;
    }

    public function lessThanOrEqual(self $other): bool
    {
        return $this->compare($other) <= 0;
    }

    public function greaterThan(self $other): bool
    {
        return $this->compare($other) > 0;
    }

    /**
     * value + 1 (decimal string arithmetic; e.g. the exclusive tombstone floor).
     */
    public function next(): self
    {
        if ($this->value === self::MAX) {
            throw new OverflowException('xid8 overflow.');
        }

        $digits = str_split($this->value);

        for ($i = count($digits) - 1; $i >= 0; $i--) {
            if ($digits[$i] !== '9') {
                $digits[$i] = (string) ((int) $digits[$i] + 1);

                return new self(implode('', $digits));
            }

            $digits[$i] = '0';
        }

        return new self('1'.implode('', $digits));
    }

    public static function max(self $a, self $b): self
    {
        return $a->compare($b) >= 0 ? $a : $b;
    }

    public function __toString(): string
    {
        return $this->value;
    }

    public function jsonSerialize(): string
    {
        return $this->value;
    }
}
