<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Enums;

enum AccountType: string
{
    case Cash = 'cash';
    case Bank = 'bank';
    case Pos = 'pos';
}
