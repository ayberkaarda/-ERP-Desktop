<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

enum ReceiptStatus: string
{
    case Draft = 'draft';
    case Posted = 'posted';
    case Cancelled = 'cancelled';
}
