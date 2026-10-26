<?php

declare(strict_types=1);

namespace App\Core\Sync;

enum MutationOp: string
{
    case Create = 'create';
    case Update = 'update';
    case Delete = 'delete';
    case Action = 'action';
}
