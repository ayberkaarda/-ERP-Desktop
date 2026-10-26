<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Enums;

enum FiscalYearStatus: string
{
    case Open = 'open';
    case Closed = 'closed';
}
