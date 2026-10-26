<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Instruments\Enums;

enum InstrumentAction: string
{
    case Receive = 'receive';
    case Issue = 'issue';
    case Endorse = 'endorse';
    case Collect = 'collect';
    case Pledge = 'pledge';
    case Release = 'release';
    case Clear = 'clear';
    case Dishonour = 'dishonour';
    case Return = 'return';
}
