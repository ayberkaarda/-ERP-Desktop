<?php

declare(strict_types=1);

namespace App\Modules\Organization\Database\factories;

use App\Modules\Organization\Models\Department;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Create inside an active company (CompanyContext::runAs).
 *
 * @extends Factory<Department>
 */
class DepartmentFactory extends Factory
{
    protected $model = Department::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'D'.Str::upper(Str::random(6)),
            'name' => fake()->jobTitle(),
        ];
    }
}
