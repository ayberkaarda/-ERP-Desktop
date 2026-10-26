<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Database\factories;

use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\Unit;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Create inside an active company (CompanyContext::runAs).
 *
 * @extends Factory<Item>
 */
class ItemFactory extends Factory
{
    protected $model = Item::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'I'.Str::upper(Str::random(8)),
            'name' => fake()->words(2, true),
            'type' => 'stock',
            'base_unit_id' => Unit::factory(),
            'tracking' => 'none',
        ];
    }
}
