<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Modules\Parties\Contracts\PartyUsageChecker;
use Illuminate\Contracts\Container\Container;

/**
 * Default PartyUsageChecker: in use as soon as any tagged checker says so; unused when none is tagged.
 */
final class TaggedPartyUsageChecker implements PartyUsageChecker
{
    public function __construct(private readonly Container $container) {}

    public function isInUse(string $companyId, string $partyId): bool
    {
        foreach ($this->container->tagged(self::TAG) as $checker) {
            if ($checker instanceof PartyUsageChecker && ! $checker instanceof self && $checker->isInUse($companyId, $partyId)) {
                return true;
            }
        }

        return false;
    }
}
