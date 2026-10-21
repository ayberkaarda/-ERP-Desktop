<?php

declare(strict_types=1);

namespace App\Modules\Reference\Enums;

enum ProjectStatus: string
{
    case Planned = 'planned';
    case Active = 'active';
    case OnHold = 'on_hold';
    case Closed = 'closed';
}
