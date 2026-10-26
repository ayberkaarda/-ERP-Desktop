<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

/** Where a report read its account totals from. */
enum Source: string
{
    case Balances = 'balances';
    case Lines = 'lines';
}
