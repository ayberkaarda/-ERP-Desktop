<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Services;

use App\Modules\Catalog\Contracts\ItemUsageChecker;
use Illuminate\Contracts\Container\Container;

/**
 * Asks every checker tagged ItemUsageChecker::TAG; none registered means unused.
 */
final class CompositeItemUsageChecker implements ItemUsageChecker
{
    public function __construct(private readonly Container $app) {}

    public function isUsed(string $itemId): bool
    {
        foreach ($this->app->tagged(self::TAG) as $checker) {
            if ($checker instanceof ItemUsageChecker && ! $checker instanceof self && $checker->isUsed($itemId)) {
                return true;
            }
        }

        return false;
    }
}
