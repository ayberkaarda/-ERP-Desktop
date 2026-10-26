<?php

declare(strict_types=1);

use Tests\TestCase;

it('accepts only keystone_test names', function (string $name): void {
    TestCase::assertSafeDatabase($name);
    expect(true)->toBeTrue();
})->with(['keystone_test', 'keystone_test_prep', 'keystone_test_a1']);

it('refuses non-test database names', function (?string $name): void {
    TestCase::assertSafeDatabase($name);
})->with(['keystone', 'keystone_test_', 'keystone_test_UP', 'postgres', null])
    ->throws(RuntimeException::class);

it('rejects an invalid KEYSTONE_TEST_DB in the bootstrap', function (string $value): void {
    $process = proc_open(
        [PHP_BINARY, '-r', 'require $argv[1];', dirname(__DIR__).'/bootstrap.php'],
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes,
        null,
        array_merge(getenv(), ['KEYSTONE_TEST_DB' => $value]),
    );
    expect($process)->not->toBeFalse();
    $out = stream_get_contents($pipes[1]).stream_get_contents($pipes[2]);

    expect(proc_close($process))->not->toBe(0)
        ->and($out)->toContain('Invalid KEYSTONE_TEST_DB');
})->with(['keystone', 'keystone_test_x;drop', 'postgres']);
