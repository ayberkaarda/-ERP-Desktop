<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Enums;

enum DocumentStatus: string
{
    case Draft = 'draft';
    case Invalid = 'invalid';
    case Ready = 'ready';
    case Sending = 'sending';
    case Sent = 'sent';
    case Delivered = 'delivered';
    case Accepted = 'accepted';
    case Rejected = 'rejected';
    case Failed = 'failed';
    case Cancelled = 'cancelled';
}
