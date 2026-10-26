<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Enums;

enum AccountType: string
{
    case Asset = 'asset';
    case Liability = 'liability';
    case Equity = 'equity';
    case Revenue = 'revenue';
    case Expense = 'expense';
    case Cost = 'cost';
    case Memo = 'memo';
}
