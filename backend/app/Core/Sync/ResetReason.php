<?php

declare(strict_types=1);

namespace App\Core\Sync;

enum ResetReason: string
{
    /** cursor.txid is at or below the tombstone floor. */
    case CursorExpired = 'cursor_expired';

    /** cursor.gen differs from the current visibility generation. */
    case VisibilityChanged = 'visibility_changed';

    /** The resource's API Resource shape changed incompatibly. */
    case SchemaChanged = 'schema_changed';
}
