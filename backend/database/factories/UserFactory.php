<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    protected $model = User::class;

    /**
     * Each factory user gets an unknown random password; tests that log in pass one explicitly.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => Str::password(32),
            'remember_token' => Str::random(10),
            'locale' => 'en',
        ];
    }

    public function unverified(): static
    {
        return $this->state(fn (): array => ['email_verified_at' => null]);
    }

    public function superAdmin(): static
    {
        return $this->state(fn (): array => ['is_super_admin' => true]);
    }

    public function inactive(): static
    {
        return $this->state(fn (): array => ['is_active' => false, 'deactivated_at' => now()]);
    }
}
