<?php

declare(strict_types=1);

namespace App\Core\Money;

use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/**
 * numeric column <-> BigDecimal. Usage: DecimalCast::class (scale 6) or DecimalCast::class.':4'.
 *
 * @implements CastsAttributes<BigDecimal|null, mixed>
 */
final class DecimalCast implements CastsAttributes
{
    /** @var int<0, max> */
    private readonly int $scale;

    public function __construct(int|string $scale = RoundingPolicy::DECIMAL_SCALE)
    {
        $this->scale = max(0, (int) $scale);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?BigDecimal
    {
        if ($value === null) {
            return null;
        }

        if (! is_string($value) && ! is_int($value)) {
            throw new InvalidArgumentException("Unexpected database value for [{$key}].");
        }

        return RoundingPolicy::round($value, $this->scale);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null) {
            return null;
        }

        // Floats have already lost precision; callers must pass strings or BigNumbers.
        if (! $value instanceof BigNumber && ! is_string($value) && ! is_int($value)) {
            throw new InvalidArgumentException("[{$key}] must be a decimal string, int or BigNumber.");
        }

        return (string) RoundingPolicy::round($value, $this->scale);
    }
}
