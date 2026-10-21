<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Reference\Contracts\ExchangeRateProvider;
use App\Modules\Reference\Exceptions\RateNotFound;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateInterval;
use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;

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
                return $this->positive(BigDecimal::of($fromRate), BigDecimal::of($toRate));
            }
        }

        throw new RateNotFound;
    }

    /** Six decimals as usual; a tiny cross rate keeps more digits instead of collapsing to zero. */
    private function positive(BigDecimal $from, BigDecimal $to): string
    {
        $rounded = $from->dividedBy($to, 6, RoundingMode::HalfUp);
        if ($rounded->isPositive()) {
            return (string) $rounded;
        }
        $exact = $from->dividedBy($to, 18, RoundingMode::HalfUp);
        if (! $exact->isPositive()) {
            throw new RateNotFound;
        }

        return (string) $exact->strippedOfTrailingZeros();
    }

    private function leg(string $currency, string $date): ?string
    {
        if ($currency === 'TRY') {
            return '1.000000';
        }
        // The active company's manual rate for the day beats the global TCMB fixing of that day;
        // other companies' manual rates are never candidates.
        $company = app(CompanyContext::class)->idOrNull();
        $value = ExchangeRate::query()->withoutGlobalScope('visible')
            ->where('currency_code', $currency)->where('rate_date', $date)->whereNotNull('forex_selling')
            ->where(function (Builder $owner) use ($company): void {
                $owner->where(fn (Builder $q) => $q->where('source', 'tcmb')->whereNull('company_id'));
                if ($company !== null) {
                    $owner->orWhere(fn (Builder $q) => $q->where('source', 'manual')->where('company_id', $company));
                }
            })
            ->orderByRaw("CASE WHEN source = 'manual' THEN 0 ELSE 1 END")
            ->value('forex_selling');

        return is_string($value) && BigDecimal::of($value)->isGreaterThan(0) ? $value : null;
    }
}
