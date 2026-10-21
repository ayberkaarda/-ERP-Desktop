<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Contracts;

/**
 * Lets other modules veto deleting an item they reference (stock moves, document lines, ...).
 *
 * Register an implementation with $app->tag([YourChecker::class], ItemUsageChecker::TAG).
 * The bound ItemUsageChecker asks every tagged checker; with none registered an item is unused.
 */
interface ItemUsageChecker
{
    public const string TAG = 'catalog.item_usage_checkers';

    public function isUsed(string $itemId): bool;
}
