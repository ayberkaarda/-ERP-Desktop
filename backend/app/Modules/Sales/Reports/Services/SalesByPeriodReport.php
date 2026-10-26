<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Data\RevenueFact;
use DateTimeImmutable;

/**
 * Net sales per day, ISO week (Monday start, key YYYY-Www) or calendar month (YYYY-MM); every
 * period touching the range is listed, empty ones with zeros, oldest first. The net of a period
 * equals the movement of the revenue accounts minus the sales returns account in the ledger.
 */
final class SalesByPeriodReport
{
    public const array PERIODS = ['day', 'week', 'month'];

    public const array COLUMNS = ['period', 'period_start', 'period_end', ...SalesBucket::AMOUNT_COLUMNS];

    public function __construct(private readonly RevenueFacts $facts) {}

    public function build(ReportFilters $f, string $period): ReportTable
    {
        /** @var array<string, SalesBucket> $buckets */
        $buckets = [];
        $bounds = [];

        foreach (self::periods((string) $f->dateFrom, (string) $f->dateTo, $period) as [$key, $start, $end]) {
            $buckets[$key] = new SalesBucket;
            $bounds[$key] = [$start, $end];
        }

        $totals = new RevenueTotals;
        $this->facts->each($f, function (RevenueFact $fact) use ($buckets, $totals, $period): void {
            $buckets[self::key($fact->date, $period)]->add($fact);
            $totals->add($fact);
        });

        $rows = [];

        foreach ($buckets as $key => $bucket) {
            $rows[] = ['period' => $key, 'period_start' => $bounds[$key][0], 'period_end' => $bounds[$key][1], ...$bucket->amounts()];
        }

        return new ReportTable($rows, self::COLUMNS, ['period' => $period, ...$totals->meta()]);
    }

    public static function key(string $date, string $period): string
    {
        $d = new DateTimeImmutable($date);

        return match ($period) {
            'day' => $d->format('Y-m-d'),
            'week' => $d->format('o-\WW'),
            default => $d->format('Y-m'),
        };
    }

    /**
     * @return list<array{0: string, 1: string, 2: string}> key, start, end
     */
    private static function periods(string $from, string $to, string $period): array
    {
        $cursor = new DateTimeImmutable($from);
        $cursor = match ($period) {
            'week' => $cursor->modify('-'.((int) $cursor->format('N') - 1).' days'),
            'month' => $cursor->modify('first day of this month'),
            default => $cursor,
        };
        $out = [];

        while ($cursor->format('Y-m-d') <= $to) {
            $next = match ($period) {
                'day' => $cursor->modify('+1 day'),
                'week' => $cursor->modify('+7 days'),
                default => $cursor->modify('first day of next month'),
            };
            $out[] = [self::key($cursor->format('Y-m-d'), $period), $cursor->format('Y-m-d'), $next->modify('-1 day')->format('Y-m-d')];
            $cursor = $next;
        }

        return $out;
    }
}
