<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\Warehouse;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Warehouse> */
final class WarehouseFactory extends Factory
{
    protected $model = Warehouse::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['code' => fake()->unique()->bothify('WH-#####'), 'name' => fake()->word(), 'is_active' => true, 'is_default' => false, 'negative_stock_policy' => 'block'];
    }
}
