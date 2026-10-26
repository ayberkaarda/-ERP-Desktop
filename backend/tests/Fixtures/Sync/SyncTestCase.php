<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use Tests\TestCase;

/**
 * Base for class-style sync read tests. Pest files get the same with uses(SyncDatabase::class).
 */
abstract class SyncTestCase extends TestCase
{
    use SyncDatabase;
}
