<?php

declare(strict_types=1);

namespace App\Modules\Parties\Database\factories;

use App\Modules\Parties\Enums\AddressType;
use App\Modules\Parties\Models\PartyAddress;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Create through a party relation inside an active company.
 *
 * @extends Factory<PartyAddress>
 */
class PartyAddressFactory extends Factory
{
    protected $model = PartyAddress::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'type' => AddressType::Billing,
            'line1' => fake()->streetAddress(),
            'city' => fake()->city(),
            'country' => 'TR',
        ];
    }
}
