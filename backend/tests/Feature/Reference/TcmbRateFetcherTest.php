<?php

declare(strict_types=1);

use App\Modules\Reference\Database\seeders\ReferenceSeeder;
use App\Modules\Reference\Exceptions\InvalidRateFeed;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Services\TcmbRateFetcher;
use GuzzleHttp\Psr7\Response;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->travelTo(now()->setDate(2026, 10, 21)->startOfDay());
    Http::preventStrayRequests();
});

it('parses realistic TCMB units and nullable banknote fields without floats', function (): void {
    $xml = file_get_contents(base_path('tests/Fixtures/Reference/today.xml'));
    expect($xml)->toBeString();
    $rates = app(TcmbRateFetcher::class)->parse($xml);
    expect($rates)->toHaveCount(4)
        ->and($rates[0]->rateDate)->toBe('2026-10-20')
        ->and($rates[0]->forexSelling)->toBe('34.200000')
        ->and($rates[1]->forexBuying)->toBe('0.223456')
        ->and($rates[1]->forexSelling)->toBe('0.224567')
        ->and($rates[1]->banknoteBuying)->toBeNull()
        ->and($rates[3]->forexSelling)->toBe('0.025340')
        ->and($rates[3]->banknoteSelling)->toBeNull()
        ->and(array_map(fn ($rate): string => $rate->currencyCode, $rates))->toBe(['USD', 'JPY', 'EUR', 'KRW']);
});

it('always targets the allowlisted host over https', function (): void {
    $fetcher = app(TcmbRateFetcher::class);
    foreach ([$fetcher->url(), $fetcher->url(new DateTimeImmutable('2026-01-02'))] as $url) {
        expect(parse_url($url, PHP_URL_SCHEME))->toBe('https')
            ->and(parse_url($url, PHP_URL_HOST))->toBe('www.tcmb.gov.tr');
    }
    expect($fetcher->url(new DateTimeImmutable('2026-01-02')))->toBe('https://www.tcmb.gov.tr/kurlar/202601/02012026.xml');
});

it('imports atomically and updates rather than duplicates a fixing', function (): void {
    $this->seed(ReferenceSeeder::class);
    Http::fake(['www.tcmb.gov.tr/*' => Http::response(file_get_contents(base_path('tests/Fixtures/Reference/today.xml')), 200)]);
    $fetcher = app(TcmbRateFetcher::class);
    expect($fetcher->import())->toBe(4);
    $fetcher->import();
    expect(ExchangeRate::query()->count())->toBe(4)
        ->and(ExchangeRate::query()->where('currency_code', 'JPY')->value('forex_selling'))->toBe('0.224567');
    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://www.tcmb.gov.tr/kurlar/today.xml');
});

it('rejects entity declarations and oversized or malformed documents', function (string $fixture): void {
    $xml = match ($fixture) {
        'xxe' => file_get_contents(base_path('tests/Fixtures/Reference/xxe.xml')),
        'large' => str_repeat('x', TcmbRateFetcher::MAX_BYTES + 1),
        'entity' => '<!ENTITY x "1"><Tarih_Date/>',
        'doctype' => '<?xml version="1.0"?><!doctype Tarih_Date SYSTEM "http://127.0.0.1/x.dtd"><Tarih_Date Tarih="20.10.2026"/>',
        'internal-dtd' => str_replace('<Tarih_Date ', '<!DOCTYPE Tarih_Date [<!ENTITY u "1">]><Tarih_Date ', (string) file_get_contents(base_path('tests/Fixtures/Reference/today.xml'))),
        'external-dtd' => str_replace('<Tarih_Date ', '<!DOCTYPE Tarih_Date SYSTEM "https://www.tcmb.gov.tr/x.dtd"><Tarih_Date ', (string) file_get_contents(base_path('tests/Fixtures/Reference/today.xml'))),
        'parameter' => "<?xml version=\"1.0\"?>\n<! DOCTYPE x [<!ENTITY % p SYSTEM \"http://127.0.0.1/\">%p;]><Tarih_Date/>",
        'nul' => "<Tarih_Date Tarih=\"20.10.2026\">\0</Tarih_Date>",
        'root' => '<wrong/>',
        default => '<Tarih_Date><Currency>',
    };
    expect(fn () => app(TcmbRateFetcher::class)->parse($xml))->toThrow(InvalidRateFeed::class);
})->with(['xxe', 'large', 'entity', 'doctype', 'internal-dtd', 'external-dtd', 'parameter', 'nul', 'root', 'malformed']);

it('rejects redirects instead of following another host', function (): void {
    Http::fake(['www.tcmb.gov.tr/*' => Http::response('', 302, ['Location' => 'http://127.0.0.1/private'])]);
    expect(fn () => app(TcmbRateFetcher::class)->fetch())->toThrow(InvalidRateFeed::class);
    Http::assertSentCount(1);
    expect(ExchangeRate::query()->count())->toBe(0);
});

it('uses dated archive URLs and rejects a different fixing date', function (): void {
    Http::fake(['www.tcmb.gov.tr/*' => Http::response(file_get_contents(base_path('tests/Fixtures/Reference/today.xml')), 200)]);
    $fetcher = app(TcmbRateFetcher::class);
    expect($fetcher->fetch(new DateTimeImmutable('2026-10-20')))->toHaveCount(4);
    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://www.tcmb.gov.tr/kurlar/202610/20102026.xml');
    expect(fn () => $fetcher->fetch(new DateTimeImmutable('2026-10-19')))->toThrow(InvalidRateFeed::class);
});

it('rejects invalid units, negative rates, duplicate currencies and future dates', function (string $before, string $after): void {
    $xml = file_get_contents(base_path('tests/Fixtures/Reference/today.xml'));
    $invalid = str_replace($before, $after, $xml);
    expect(fn () => app(TcmbRateFetcher::class)->parse($invalid))->toThrow(InvalidRateFeed::class);
})->with([
    ['<Unit>100</Unit>', '<Unit>0</Unit>'],
    ['<ForexBuying>34.1000</ForexBuying>', '<ForexBuying>-1</ForexBuying>'],
    ['CurrencyCode="EUR"', 'CurrencyCode="USD"'],
    ['20.10.2026', '22.10.2026'],
]);

it('exposes fetch and backfill commands with strict date validation', function (): void {
    Http::fake();
    $this->artisan('rates:fetch-tcmb', ['--date' => '2026-02-30'])->assertExitCode(2);
    $this->artisan('rates:backfill', ['--from' => '2026-10-21', '--to' => '2026-10-20'])->assertExitCode(2);
    Http::assertNothingSent();
});

it('fetches a dated fixing through the console command', function (): void {
    $this->seed(ReferenceSeeder::class);
    Http::fake(['www.tcmb.gov.tr/*' => Http::response(file_get_contents(base_path('tests/Fixtures/Reference/today.xml')), 200)]);
    $this->artisan('rates:fetch-tcmb', ['--date' => '2026-10-20'])->assertSuccessful();
    expect(ExchangeRate::query()->count())->toBe(4);
});

it('configures transfer limits, timeout and disabled redirects', function (): void {
    Http::fake(function (Request $request, array $options) {
        expect($options['timeout'])->toBe(10)
            ->and($options['connect_timeout'])->toBe(10)
            ->and($options['allow_redirects'])->toBeFalse();
        $response = new Response(200, ['Content-Length' => TcmbRateFetcher::MAX_BYTES + 1]);
        expect(fn () => $options['on_headers']($response))->toThrow(InvalidRateFeed::class);
        expect(fn () => $options['progress'](0, TcmbRateFetcher::MAX_BYTES + 1))->toThrow(InvalidRateFeed::class);

        return Http::response(file_get_contents(base_path('tests/Fixtures/Reference/today.xml')), 200);
    });
    expect(app(TcmbRateFetcher::class)->fetch())->toHaveCount(4);
});

it('backfills weekdays and does not hide a missing fixing', function (): void {
    $this->seed(ReferenceSeeder::class);
    Http::fake(['www.tcmb.gov.tr/*' => Http::response('', 404)]);
    $this->artisan('rates:backfill', ['--from' => '2026-10-17', '--to' => '2026-10-19'])->assertFailed();
    Http::assertSentCount(1);
    expect(ExchangeRate::query()->count())->toBe(0);
});
