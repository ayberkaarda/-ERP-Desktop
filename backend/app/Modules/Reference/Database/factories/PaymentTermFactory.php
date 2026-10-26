<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\PaymentTerm;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PaymentTerm> */
final class PaymentTermFactory extends Factory
{
    protected $model = PaymentTerm::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['code' => fake()->unique()->bothify('TERM-#####'), 'name' => fake()->word(), 'due_days' => 30, 'discount_percent' => '0.0000', 'discount_days' => 0, 'is_active' => true];
    }
}
