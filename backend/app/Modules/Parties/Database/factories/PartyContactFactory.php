<?php

declare(strict_types=1);

namespace App\Modules\Parties\Database\factories;

use App\Modules\Parties\Models\PartyContact;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Create through a party relation inside an active company.
 *
 * @extends Factory<PartyContact>
 */
class PartyContactFactory extends Factory
{
    protected $model = PartyContact::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['name' => fake()->name(), 'email' => fake()->safeEmail()];
    }
}
