<?php

declare(strict_types=1);

namespace App\Modules\Reference\Enums;

enum TaxType: string
{
    case Vat = 'vat';
    case Withholding = 'withholding';
    case Excise = 'excise';
    case Exemption = 'exemption';
    case Other = 'other';
}
