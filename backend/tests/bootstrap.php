<?php

declare(strict_types=1);

require __DIR__.'/../vendor/autoload.php';

/*
 * Selects the test database for this run. Parallel lanes may use
 * KEYSTONE_TEST_DB=keystone_test_<lane> on one Postgres; anything else is refused.
 */
(static function (): void {
    $name = getenv('KEYSTONE_TEST_DB');
    $name = $name === false || $name === '' ? 'keystone_test' : $name;

    $port = getenv('KEYSTONE_TEST_DB_PORT');
    $port = $port === false || $port === '' ? '5433' : $port;

    if (preg_match('/^keystone_test(_[a-z0-9]{1,20})?$/', $name) !== 1) {
        throw new RuntimeException(sprintf('Invalid KEYSTONE_TEST_DB [%s].', $name));
    }

    if (preg_match('/^[0-9]{1,5}$/', $port) !== 1 || (int) $port < 1 || (int) $port > 65535) {
        throw new RuntimeException(sprintf('Invalid KEYSTONE_TEST_DB_PORT [%s].', $port));
    }

    foreach (['DB_DATABASE' => $name, 'DB_PORT' => $port] as $key => $value) {
        putenv("$key=$value");
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
    }
})();
