<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Instruments\Enums;

enum InstrumentStatus: string
{
    case Draft = 'draft';
    case Portfolio = 'portfolio';
    case Issued = 'issued';
    case Collection = 'collection';
    case Pledged = 'pledged';
    case Cleared = 'cleared';
    case Endorsed = 'endorsed';
    case Dishonoured = 'dishonoured';
    case Returned = 'returned';
}
