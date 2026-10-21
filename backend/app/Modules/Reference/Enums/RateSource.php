<?php

declare(strict_types=1);

namespace App\Modules\Reference\Enums;

enum RateSource: string
{
    case Tcmb = 'tcmb';
    case Manual = 'manual';
}
