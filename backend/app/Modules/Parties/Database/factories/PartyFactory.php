<?php

declare(strict_types=1);

namespace App\Modules\Parties\Database\factories;

use App\Modules\Parties\Enums\PartyRole;
use App\Modules\Parties\Enums\PartyType;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Validation\Tckn;
use App\Modules\Parties\Validation\Vkn;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * Create inside an active company (CompanyContext::runAs). Codes here bypass the number sequence.
 *
 * @extends Factory<Party>
 */
class PartyFactory extends Factory
{
    protected $model = Party::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'code' => 'F'.Str::upper(Str::random(8)),
            'name' => fake()->company(),
            'type' => PartyType::Company,
            'roles' => [PartyRole::Customer->value],
            'country' => 'TR',
            'tax_number' => self::vkn(),
        ];
    }

    public function person(): static
    {
        return $this->state(fn (): array => ['type' => PartyType::Person, 'name' => fake()->name(), 'tax_number' => self::tckn()]);
    }

    public function supplier(): static
    {
        return $this->state(fn (): array => ['roles' => [PartyRole::Supplier->value]]);
    }

    public static function vkn(): string
    {
        $first = str_pad((string) random_int(0, 999_999_999), 9, '0', STR_PAD_LEFT);

        return $first.Vkn::checkDigit($first);
    }

    public static function tckn(): string
    {
        $first = (string) random_int(100_000_000, 999_999_999);

        return $first.Tckn::checkDigits($first);
    }
}
