<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

it('gives the test connection its session lock_timeout', function (): void {
    // A misspelt server option would be dropped silently and leave lock waits unbounded.
    $same = DB::selectOne(
        "select (select setting::bigint from pg_settings where name = 'lock_timeout') = extract(epoch from ?::interval) * 1000 as same",
        [TestCase::LOCK_TIMEOUT],
    )->same;

    expect($same)->toBeTrue();
});
