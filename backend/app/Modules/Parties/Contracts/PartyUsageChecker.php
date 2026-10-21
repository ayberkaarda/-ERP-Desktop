<?php

declare(strict_types=1);

namespace App\Modules\Parties\Contracts;

/**
 * Answers whether a party is referenced elsewhere, which turns DELETE /parties/{id} into a
 * deactivation. The bound implementation asks every checker tagged with TAG; modules that
 * reference parties register theirs in their provider:
 *     $this->app->tag([MyPartyUsageChecker::class], PartyUsageChecker::TAG);
 * With no checkers registered every party counts as unused.
 */
interface PartyUsageChecker
{
    public const string TAG = 'parties.usage_checkers';

    public function isInUse(string $companyId, string $partyId): bool;
}
