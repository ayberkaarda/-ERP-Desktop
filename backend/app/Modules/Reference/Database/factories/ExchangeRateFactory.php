<?php

declare(strict_types=1);

namespace App\Modules\Reference\Database\factories;

use App\Modules\Reference\Models\ExchangeRate;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ExchangeRate> */
final class ExchangeRateFactory extends Factory
{
    protected $model = ExchangeRate::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return ['currency_code' => 'USD', 'rate_date' => '2026-10-20', 'forex_buying' => '34.000000', 'forex_selling' => '35.000000', 'source' => 'tcmb'];
    }
}
