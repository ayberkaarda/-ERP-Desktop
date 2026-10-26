<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Support;

use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Settings\Contracts\SettingsReader;
use DateTimeImmutable;

final class TreasurySettings
{
    public function baseCurrency(): string
    {
        $value = app(SettingsReader::class)->get('company.base_currency');

        return is_string($value) && $value !== '' ? $value : 'TRY';
    }

    public function rate(string $currency, string $date, ?string $rate): string
    {
        if ($currency === $this->baseCurrency()) {
            if ($rate !== null && ! Treasury::decimal($rate)->isEqualTo(1)) {
                Treasury::fail('fx_rate', 'base_rate');
            }

            return '1.000000';
        }
        $value = $rate ?? app(ExchangeRateProvider::class)->rate($currency, $this->baseCurrency(), new DateTimeImmutable($date));
        if (! Treasury::decimal($value)->isPositive()) {
            Treasury::fail('fx_rate', 'positive');
        }

        return (string) Treasury::decimal($value)->toScale(6);
    }

    public function approvalThreshold(): ?string
    {
        $v = app(SettingsReader::class)->get('treasury.require_approval_over');

        return is_string($v) && $v !== '' ? $v : null;
    }
}
