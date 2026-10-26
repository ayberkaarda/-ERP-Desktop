<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Machines;

use App\Core\Documents\StateMachine;

/** The first quote entered moves a sent RFQ to collecting; award ends it. */
final class RfqMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['sent', 'cancelled'],
            'sent' => ['collecting', 'awarded', 'cancelled'],
            'collecting' => ['awarded', 'cancelled'],
        ];
    }
}
