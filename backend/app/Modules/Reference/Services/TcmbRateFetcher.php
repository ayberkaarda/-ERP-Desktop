<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

use App\Modules\Reference\Data\RateData;
use App\Modules\Reference\Exceptions\InvalidRateFeed;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Psr\Http\Message\ResponseInterface;
use SimpleXMLElement;

final class TcmbRateFetcher
{
    public const int MAX_BYTES = 1048576;

    public function url(?DateTimeInterface $date = null): string
    {
        return $date === null
            ? 'https://www.tcmb.gov.tr/kurlar/today.xml'
            : 'https://www.tcmb.gov.tr/kurlar/'.$date->format('Ym/dmY').'.xml';
    }

    /** @return list<RateData> */
    public function fetch(?DateTimeInterface $date = null): array
    {
        $url = $this->url($date);
        if (parse_url($url, PHP_URL_HOST) !== 'www.tcmb.gov.tr' || parse_url($url, PHP_URL_SCHEME) !== 'https') {
            throw new InvalidRateFeed;
        }
        $response = Http::timeout(10)->connectTimeout(10)->withOptions([
            'allow_redirects' => false,
            'on_headers' => static function (ResponseInterface $response): void {
                $length = $response->getHeaderLine('Content-Length');
                if ($length !== '' && (! ctype_digit($length) || (int) $length > self::MAX_BYTES)) {
                    throw new InvalidRateFeed;
                }
            },
            'progress' => static function (int|float $total, int|float $downloaded): void {
                if ($total > self::MAX_BYTES || $downloaded > self::MAX_BYTES) {
                    throw new InvalidRateFeed;
                }
            },
        ])->get($url);
        if (! $response->successful() || $response->redirect()) {
            throw new InvalidRateFeed;
        }
        $rates = $this->parse($response->body());
        if ($date !== null && $rates[0]->rateDate !== $date->format('Y-m-d')) {
            throw new InvalidRateFeed;
        }

        return $rates;
    }

    /** @return list<RateData> */
    public function parse(string $xml): array
    {
        if ($xml === '' || strlen($xml) > self::MAX_BYTES || str_contains($xml, "\0")
            || preg_match('/<!\s*(?:DOCTYPE|ENTITY)\b/i', $xml) === 1) {
            throw new InvalidRateFeed;
        }
        $previous = libxml_use_internal_errors(true);
        try {
            $root = simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET);
            if ($root === false || $root->getName() !== 'Tarih_Date') {
                throw new InvalidRateFeed;
            }
            $rawDate = (string) $root['Tarih'];
            $date = DateTimeImmutable::createFromFormat('!d.m.Y', $rawDate);
            if ($date === false || $date->format('d.m.Y') !== $rawDate || $date->format('Y-m-d') > now('Europe/Istanbul')->format('Y-m-d')) {
                throw new InvalidRateFeed;
            }
            $result = [];
            $seen = [];
            foreach ($root->Currency as $node) {
                $code = (string) $node['CurrencyCode'];
                $unit = trim((string) $node->Unit);
                if (preg_match('/^[A-Z]{3}$/D', $code) !== 1 || $code === 'TRY' || isset($seen[$code])
                    || preg_match('/^[1-9]\d{0,5}$/D', $unit) !== 1) {
                    throw new InvalidRateFeed;
                }
                $seen[$code] = true;
                $buying = $this->decimal((string) $node->ForexBuying, $unit);
                $selling = $this->decimal((string) $node->ForexSelling, $unit);
                // XDR is published with a buying rate only; it is not a tradable currency here.
                if ($buying === null || $selling === null) {
                    continue;
                }
                $result[] = new RateData(
                    $code, $date->format('Y-m-d'), $buying, $selling,
                    $this->decimal((string) $node->BanknoteBuying, $unit),
                    $this->decimal((string) $node->BanknoteSelling, $unit),
                );
            }
            if ($result === []) {
                throw new InvalidRateFeed;
            }

            return $result;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    public function import(?DateTimeInterface $date = null): int
    {
        $rates = $this->fetch($date);

        return DB::transaction(function () use ($rates): int {
            $count = 0;
            foreach ($rates as $rate) {
                if (! Currency::query()->where('code', $rate->currencyCode)->exists()) {
                    continue;
                }
                DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['reference:tcmb:'.$rate->currencyCode.':'.$rate->rateDate]);
                ExchangeRate::query()->updateOrCreate([
                    'currency_code' => $rate->currencyCode, 'rate_date' => $rate->rateDate, 'source' => 'tcmb',
                ], $rate->attributes());
                $count++;
            }

            return $count;
        });
    }

    private function decimal(string $value, string $unit): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        if (preg_match('/^\d{1,14}(\.\d{1,6})?$/D', $value) !== 1 || BigDecimal::of($value)->isLessThanOrEqualTo(0)) {
            throw new InvalidRateFeed;
        }
        $normalised = BigDecimal::of($value)->dividedBy($unit, 6, RoundingMode::HalfUp);
        if ($normalised->isLessThanOrEqualTo(0)) {
            throw new InvalidRateFeed;
        }

        return (string) $normalised;
    }
}
