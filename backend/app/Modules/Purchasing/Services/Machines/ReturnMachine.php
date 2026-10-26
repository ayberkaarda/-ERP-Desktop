<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Machines;

use App\Core\Documents\StateMachine;

/**
 * debited -> shipped happens only when the debit note is reversed (it can then be debited again).
 */
final class ReturnMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['approved', 'cancelled'],
            'approved' => ['shipped', 'cancelled'],
            'shipped' => ['debited'],
            'debited' => ['shipped'],
        ];
    }
}
