<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Exceptions\RateNotFound;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateInterval;
use DateTimeImmutable;
use DateTimeInterface;

final class DatabaseExchangeRateProvider implements ExchangeRateProvider
{
    public function rate(string $from, string $to, DateTimeInterface $date): string
    {
        foreach (array_unique([$from, $to]) as $code) {
            if (! Currency::query()->where('code', $code)->where('is_active', true)->exists()) {
                throw new RateNotFound;
            }
        }
        if ($from === $to) {
            return '1.000000';
        }
        $day = DateTimeImmutable::createFromInterface($date);
        // Both legs use the same fixing date to avoid mixing different market days.
        for ($offset = 0; $offset <= 7; $offset++) {
            $fixing = $day->sub(new DateInterval('P'.$offset.'D'))->format('Y-m-d');
            $fromRate = $this->leg($from, $fixing);
            $toRate = $this->leg($to, $fixing);
            if ($fromRate !== null && $toRate !== null) {
                return (string) BigDecimal::of($fromRate)->dividedBy($toRate, 6, RoundingMode::HalfUp);
            }
        }

        throw new RateNotFound;
    }

    private function leg(string $currency, string $date): ?string
    {
        if ($currency === 'TRY') {
            return '1.000000';
        }
        // Manual corrections take precedence over the central-bank fixing.
        $value = ExchangeRate::query()->where('currency_code', $currency)->where('rate_date', $date)
            ->whereNotNull('forex_selling')->orderByRaw("CASE WHEN source = 'manual' THEN 0 ELSE 1 END")
            ->value('forex_selling');

        return is_string($value) && BigDecimal::of($value)->isGreaterThan(0) ? $value : null;
    }
}
