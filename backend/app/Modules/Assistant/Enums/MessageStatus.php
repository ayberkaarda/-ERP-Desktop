<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Enums;

enum MessageStatus: string
{
    case Processing = 'processing';
    case Completed = 'completed';
    case PendingApproval = 'pending_approval';
    case Failed = 'failed';
}
