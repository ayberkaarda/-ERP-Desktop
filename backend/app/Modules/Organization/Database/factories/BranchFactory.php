<?php

declare(strict_types=1);

namespace App\Modules\Organization\Database\factories;

use App\Modules\Organization\Models\Branch;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Create inside an active company (CompanyContext::runAs).
 *
 * @extends Factory<Branch>
 */
class BranchFactory extends Factory
{
    protected $model = Branch::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'B'.Str::upper(Str::random(6)),
            'name' => fake()->city(),
        ];
    }
}
