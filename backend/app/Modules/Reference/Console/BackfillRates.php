<?php

declare(strict_types=1);

namespace App\Modules\Reference\Console;

use App\Modules\Reference\Services\TcmbRateFetcher;
use DateInterval;
use DateTimeImmutable;
use Illuminate\Console\Command;
use Throwable;

final class BackfillRates extends Command
{
    protected $signature = 'rates:backfill {--from=} {--to=}';

    protected $description = 'Import a date range of TCMB exchange rates';

    public function handle(TcmbRateFetcher $fetcher): int
    {
        $from = $this->date($this->option('from'));
        $to = $this->date($this->option('to'));
        if ($from === null || $to === null || $from > $to || $to->format('Y-m-d') > now('Europe/Istanbul')->toDateString()) {
            $this->error(__('reference::messages.invalid_date'));

            return self::INVALID;
        }
        $failed = false;
        for ($day = $from; $day <= $to; $day = $day->add(new DateInterval('P1D'))) {
            if ((int) $day->format('N') >= 6) {
                continue;
            }
            try {
                $fetcher->import($day);
            } catch (Throwable $exception) {
                report($exception);
                $failed = true;
                $this->warn(__('reference::messages.missing_date', ['date' => $day->format('Y-m-d')]));
            }
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }

    private function date(mixed $value): ?DateTimeImmutable
    {
        if (! is_string($value)) {
            return null;
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        return $date !== false && $date->format('Y-m-d') === $value ? $date : null;
    }
}
