<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

/** purchase = supplier invoice; return = debit note issued for returned goods. */
enum InvoiceType: string
{
    case Purchase = 'purchase';
    case Return = 'return';
}
