<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Enums;

enum StatementStatus: string
{
    case Imported = 'imported';
    case Reconciled = 'reconciled';
}
