<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Database\factories;

use App\Modules\Catalog\Models\Unit;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Create inside an active company (CompanyContext::runAs).
 *
 * @extends Factory<Unit>
 */
class UnitFactory extends Factory
{
    protected $model = Unit::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'U'.Str::upper(Str::random(6)),
            'name' => fake()->word(),
            'symbol' => null,
        ];
    }
}
