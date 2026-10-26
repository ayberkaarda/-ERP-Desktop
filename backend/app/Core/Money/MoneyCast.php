<?php

declare(strict_types=1);

namespace App\Core\Money;

use Brick\Math\BigDecimal;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * numeric(20,4) money column <-> BigDecimal at scale 4.
 *
 * @implements CastsAttributes<BigDecimal|null, mixed>
 */
final class MoneyCast implements CastsAttributes
{
    private readonly DecimalCast $inner;

    public function __construct()
    {
        $this->inner = new DecimalCast(RoundingPolicy::MONEY_SCALE);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): ?BigDecimal
    {
        return $this->inner->get($model, $key, $value, $attributes);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        return $this->inner->set($model, $key, $value, $attributes);
    }
}
