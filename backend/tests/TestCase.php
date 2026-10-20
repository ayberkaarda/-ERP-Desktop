<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /** Keep in sync with tests/bootstrap.php. */
    public const string TEST_DATABASE_PATTERN = '/^keystone_test(_[a-z0-9]{1,20})?$/';

    /**
     * Refuses any database that is not a keystone_test[_lane] database.
     */
    public static function assertSafeDatabase(?string $name): void
    {
        if ($name === null || preg_match(self::TEST_DATABASE_PATTERN, $name) !== 1) {
            throw new RuntimeException(sprintf(
                'Refusing to run tests against database [%s]; expected keystone_test or keystone_test_<lane>.',
                $name ?? 'unknown',
            ));
        }
    }

    /**
     * Runs before RefreshDatabase so a misconfigured env can never wipe a real database.
     */
    public function createApplication(): Application
    {
        $app = require Application::inferBasePath().'/bootstrap/app.php';
        // Tests never read a developer's .env (nor warn when CI has none): test values live in
        // phpunit.xml; tests/testing.env is an intentionally empty environment file.
        $app->useEnvironmentPath($app->basePath('tests'))->loadEnvironmentFrom('testing.env');
        $this->traitsUsedByTest = class_uses_recursive(static::class);
        $app->make(Kernel::class)->bootstrap();

        $row = DB::selectOne('select current_database() as name');
        $name = is_object($row) && property_exists($row, 'name') && is_string($row->name) ? $row->name : null;

        self::assertSafeDatabase($name);

        return $app;
    }
}
