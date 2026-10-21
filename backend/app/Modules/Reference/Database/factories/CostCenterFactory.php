<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\CostCenter;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<CostCenter> */
final class CostCenterFactory extends Factory
{
    protected $model = CostCenter::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['code' => fake()->unique()->bothify('CC-#####'), 'name' => fake()->word(), 'is_active' => true];
    }
}
