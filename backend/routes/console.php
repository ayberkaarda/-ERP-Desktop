<?php

declare(strict_types=1);

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

// key:generate always rotates the key, which would invalidate existing sessions and encrypted data.
Artisan::command('key:ensure', function (): int {
    /** @var Command $this */
    if (filled(config('app.key'))) {
        $this->components->info('Application key already set.');

        return Command::SUCCESS;
    }

    return $this->call('key:generate');
})->purpose('Generate the application key only when it is missing');
