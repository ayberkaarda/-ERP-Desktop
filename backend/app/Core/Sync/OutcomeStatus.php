<?php

declare(strict_types=1);

namespace App\Core\Sync;

/**
 * Status of one push result. Adapters produce applied, conflict or rejected; duplicate only
 * appears when a stored applied outcome is replayed for the same idempotency key.
 */
enum OutcomeStatus: string
{
    case Applied = 'applied';
    case Duplicate = 'duplicate';
    case Conflict = 'conflict';
    case Rejected = 'rejected';
}
