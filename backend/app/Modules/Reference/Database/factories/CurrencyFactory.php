<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\Currency;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Currency> */
final class CurrencyFactory extends Factory
{
    protected $model = Currency::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['code' => 'USD', 'name' => 'US dollar', 'symbol' => '$', 'decimals' => 2, 'is_active' => true];
    }
}
