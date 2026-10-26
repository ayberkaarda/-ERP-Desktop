<?php

declare(strict_types=1);

namespace App\Core\Sync;

/**
 * Resolution options offered with a conflict (push.response.schema.json#/$defs/conflict).
 */
enum ConflictChoice: string
{
    case KeepMine = 'keep_mine';
    case TakeServer = 'take_server';
    case Merge = 'merge';
    case SaveAsNewDraft = 'save_as_new_draft';
    case Discard = 'discard';
    case UseExisting = 'use_existing';
}
