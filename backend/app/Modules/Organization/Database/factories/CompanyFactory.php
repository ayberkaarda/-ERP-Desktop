<?php

declare(strict_types=1);

namespace App\Modules\Organization\Database\factories;

use App\Modules\Organization\Models\Company;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Company>
 */
class CompanyFactory extends Factory
{
    protected $model = Company::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'C'.Str::upper(Str::random(8)),
            'name' => fake()->company(),
        ];
    }
}
