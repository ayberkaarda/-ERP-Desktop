<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\Contracts\SyncWriter;
use Illuminate\Contracts\Container\Container;

/**
 * Module adapters tagged with SyncResource::TAG / SyncWriter::TAG, by manifest resource name.
 * Resolved on every call, so adapters tagged after boot (tests, late providers) are seen.
 */
final readonly class Adapters
{
    public function __construct(private Container $app) {}

    public function resource(string $name): ?SyncResource
    {
        foreach ($this->app->tagged(SyncResource::TAG) as $adapter) {
            if ($adapter instanceof SyncResource && $adapter->name() === $name) {
                return $adapter;
            }
        }

        return null;
    }

    public function writer(string $name): ?SyncWriter
    {
        foreach ($this->app->tagged(SyncWriter::TAG) as $adapter) {
            if ($adapter instanceof SyncWriter && $adapter->resource() === $name) {
                return $adapter;
            }
        }

        return null;
    }
}
