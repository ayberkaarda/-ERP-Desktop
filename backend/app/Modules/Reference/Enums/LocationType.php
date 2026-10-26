<?php

declare(strict_types=1);

namespace App\Modules\Reference\Enums;

enum LocationType: string
{
    case Aisle = 'aisle';
    case Rack = 'rack';
    case Shelf = 'shelf';
    case Bin = 'bin';
}
