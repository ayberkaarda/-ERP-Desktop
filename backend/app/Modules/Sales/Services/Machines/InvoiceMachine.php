<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Machines;

use App\Core\Documents\StateMachine;

/**
 * Paid states are set by ReceivableSettlement (treasury); this phase issues and reverses.
 */
final class InvoiceMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['pending_approval', 'issued', 'cancelled'],
            'pending_approval' => ['issued', 'draft', 'cancelled'],
            'issued' => ['partially_paid', 'paid', 'reversed'],
            'partially_paid' => ['issued', 'paid'],
            'paid' => ['issued', 'partially_paid'],
        ];
    }
}
