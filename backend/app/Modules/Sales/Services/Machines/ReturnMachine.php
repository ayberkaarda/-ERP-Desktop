<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Machines;

use App\Core\Documents\StateMachine;

/**
 * credited -> received happens only when the credit note is reversed (it can then be credited again).
 */
final class ReturnMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['approved', 'cancelled'],
            'approved' => ['received', 'cancelled'],
            'received' => ['credited'],
            'credited' => ['received'],
        ];
    }
}
