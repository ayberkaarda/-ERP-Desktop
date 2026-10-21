<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\TaxCode;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<TaxCode> */
final class TaxCodeFactory extends Factory
{
    protected $model = TaxCode::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['code' => 'CUSTOM'.fake()->unique()->numerify('#####'), 'name' => 'Custom tax', 'type' => 'vat', 'rate' => '20.0000', 'effective_from' => '2023-07-10', 'is_active' => true, 'meta' => ['status' => 'needs_review']];
    }
}
