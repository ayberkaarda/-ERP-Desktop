<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Instruments\Enums;

enum InstrumentKind: string
{
    case Cheque = 'cheque';
    case Note = 'note';
}
