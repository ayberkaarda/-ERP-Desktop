<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Enums;

enum PlanStatus: string
{
    case Scheduled = 'scheduled';
    case Fulfilled = 'fulfilled';
    case Cancelled = 'cancelled';
}
