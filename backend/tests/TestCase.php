<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    private const string TEST_DATABASE = 'keystone_test';

    /**
     * Runs before RefreshDatabase so a misconfigured env can never wipe a real database.
     */
    public function createApplication(): Application
    {
        $app = parent::createApplication();

        $row = DB::selectOne('select current_database() as name');
        $name = is_object($row) && property_exists($row, 'name') ? $row->name : null;

        if ($name !== self::TEST_DATABASE) {
            throw new RuntimeException(sprintf(
                'Refusing to run tests against database [%s]; expected [%s].',
                is_scalar($name) ? (string) $name : 'unknown',
                self::TEST_DATABASE,
            ));
        }

        return $app;
    }
}
