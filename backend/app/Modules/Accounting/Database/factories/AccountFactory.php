<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Database\factories;

use App\Modules\Accounting\Models\Account;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Root postable accounts; create sub-accounts through ChartOfAccounts so the tree rules apply.
 *
 * @extends Factory<Account>
 */
final class AccountFactory extends Factory
{
    protected $model = Account::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'code' => (string) $this->faker->unique()->numberBetween(100000, 999999),
            'name' => $this->faker->words(2, true),
            'type' => 'asset',
            'normal_balance' => 'debit',
            'is_postable' => true,
            'is_active' => true,
        ];
    }
}
