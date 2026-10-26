<?php

declare(strict_types=1);

namespace App\Core\Sync;

enum TombstoneReason: string
{
    /** Row was physically deleted. */
    case Deleted = 'deleted';

    /** deleted_at was set (SoftDeletes). */
    case SoftDeleted = 'soft_deleted';

    /** Live row changed and left the resource window; produced at pull time, never stored. */
    case OutOfScope = 'out_of_scope';
}
