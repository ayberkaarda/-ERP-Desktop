<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\CompanyCurrency;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<CompanyCurrency> */
final class CompanyCurrencyFactory extends Factory
{
    protected $model = CompanyCurrency::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['currency_code' => 'USD', 'is_active' => true];
    }
}
