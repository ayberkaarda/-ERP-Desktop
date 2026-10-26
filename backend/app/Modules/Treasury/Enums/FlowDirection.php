<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Enums;

enum FlowDirection: string
{
    case Receipt = 'receipt';
    case Payment = 'payment';
}
