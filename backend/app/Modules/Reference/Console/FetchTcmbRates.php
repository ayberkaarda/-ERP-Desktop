<?php

declare(strict_types=1);

namespace App\Modules\Reference\Console;

use App\Modules\Reference\Services\TcmbRateFetcher;
use DateTimeImmutable;
use Illuminate\Console\Command;
use Throwable;

final class FetchTcmbRates extends Command
{
    protected $signature = 'rates:fetch-tcmb {--date=}';

    protected $description = 'Import TCMB exchange rates';

    public function handle(TcmbRateFetcher $fetcher): int
    {
        $option = $this->option('date');
        $date = null;
        if (is_string($option)) {
            $date = DateTimeImmutable::createFromFormat('!Y-m-d', $option);
            if ($date === false || $date->format('Y-m-d') !== $option || $option > now('Europe/Istanbul')->toDateString()) {
                $this->error(__('reference::messages.invalid_date'));

                return self::INVALID;
            }
        }
        try {
            $count = $fetcher->import($date);
            $this->info(__('reference::messages.imported', ['count' => $count]));

            return self::SUCCESS;
        } catch (Throwable $exception) {
            report($exception);
            $this->error(__('reference::messages.fetch_failed'));

            return self::FAILURE;
        }
    }
}
