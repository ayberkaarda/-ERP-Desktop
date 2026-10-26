<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Enums;

/**
 * TDHP class 7 layout: 7/A (functional cost accounts 710-770) or 7/B (expense types 790-799).
 */
enum ExpenseScheme: string
{
    case A = '7A';
    case B = '7B';
}
