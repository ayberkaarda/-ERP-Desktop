<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Enums;

enum PeriodStatus: string
{
    case Open = 'open';
    case SoftClosed = 'soft_closed';
    case Closed = 'closed';
}
