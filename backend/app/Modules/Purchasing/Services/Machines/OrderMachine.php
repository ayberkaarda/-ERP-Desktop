<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Machines;

use App\Core\Documents\StateMachine;

/**
 * Progress states (approved/sent .. invoiced) follow the received and invoiced quantities, so they
 * move both ways when a receipt is cancelled or an invoice reversed.
 */
final class OrderMachine extends StateMachine
{
    private const array PROGRESS = ['approved', 'sent', 'partially_received', 'received', 'partially_invoiced', 'invoiced'];

    protected function transitions(): array
    {
        $map = [
            'draft' => ['pending_approval', 'approved', 'cancelled'],
            'pending_approval' => ['approved', 'draft', 'cancelled'],
        ];

        foreach (self::PROGRESS as $from) {
            $map[$from] = [...array_values(array_diff(self::PROGRESS, [$from])), 'closed'];
        }

        foreach (['approved', 'sent'] as $from) {
            $map[$from][] = 'cancelled';
            $map[$from][] = 'pending_approval';
        }

        return $map;
    }
}
