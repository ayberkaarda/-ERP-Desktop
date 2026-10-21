<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\Warehouse;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Location> */
final class LocationFactory extends Factory
{
    protected $model = Location::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['warehouse_id' => Warehouse::factory(), 'code' => fake()->unique()->bothify('LOC-#####'), 'name' => fake()->word(), 'type' => 'bin', 'is_active' => true];
    }
}
