<?php

declare(strict_types=1);

namespace App\Modules\Parties\Database\factories;

use App\Modules\Parties\Models\PartyBankAccount;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Create through a party relation inside an active company.
 *
 * @extends Factory<PartyBankAccount>
 */
class PartyBankAccountFactory extends Factory
{
    protected $model = PartyBankAccount::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['bank_name' => 'Test Bank', 'iban' => 'TR330006100519786457841326'];
    }
}
