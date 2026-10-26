<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Enums;

enum ToolStatus: string
{
    case Pending = 'pending';
    case Completed = 'completed';
    case Rejected = 'rejected';
    case Failed = 'failed';
}
