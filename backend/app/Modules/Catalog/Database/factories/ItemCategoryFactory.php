<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Database\factories;

use App\Modules\Catalog\Models\ItemCategory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Root categories; use the CategoryTree service for children. Create inside an active company.
 *
 * @extends Factory<ItemCategory>
 */
class ItemCategoryFactory extends Factory
{
    protected $model = ItemCategory::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $id = (string) Str::uuid7();

        return [
            'id' => $id,
            'code' => 'C'.Str::upper(Str::random(6)),
            'name' => fake()->word(),
            'path' => "/{$id}/",
            'depth' => 1,
        ];
    }
}
