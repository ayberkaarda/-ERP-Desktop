<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Instruments\Enums;

enum InstrumentDirection: string
{
    case Received = 'received';
    case Issued = 'issued';
}
