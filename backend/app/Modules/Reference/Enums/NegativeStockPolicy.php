<?php

declare(strict_types=1);

namespace App\Modules\Reference\Enums;

enum NegativeStockPolicy: string
{
    case Allow = 'allow';
    case Warn = 'warn';
    case Block = 'block';
}
