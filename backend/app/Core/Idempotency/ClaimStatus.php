<?php

declare(strict_types=1);

namespace App\Core\Idempotency;

enum ClaimStatus: string
{
    /** The key is ours: do the work, then complete() or release(). */
    case Claimed = 'claimed';

    /** Same key and fingerprint finished before: serve the stored response. */
    case Completed = 'completed';

    /** Same key, different fingerprint (IDEMPOTENCY_KEY_REUSED). */
    case Reused = 'reused';

    /** Another holder is still working on it, or the row vanished in a race (IDEMPOTENCY_IN_PROGRESS). */
    case InProgress = 'in_progress';
}
