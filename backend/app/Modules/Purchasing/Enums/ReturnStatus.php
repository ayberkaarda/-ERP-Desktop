<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

enum ReturnStatus: string
{
    case Draft = 'draft';
    case Approved = 'approved';
    case Shipped = 'shipped';
    case Debited = 'debited';
    case Cancelled = 'cancelled';
}
