<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Machines;

use App\Core\Documents\StateMachine;

/**
 * Paid states are set by PayableSettlement (treasury); this phase books and reverses.
 */
final class InvoiceMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['pending_approval', 'booked', 'cancelled'],
            'pending_approval' => ['booked', 'draft', 'cancelled'],
            'booked' => ['partially_paid', 'paid', 'reversed'],
            'partially_paid' => ['booked', 'paid'],
            'paid' => ['booked', 'partially_paid'],
        ];
    }
}
