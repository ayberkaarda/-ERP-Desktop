<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Enums;

enum EntryStatus: string
{
    case Draft = 'draft';
    case Posted = 'posted';
    case Reversed = 'reversed';
}
