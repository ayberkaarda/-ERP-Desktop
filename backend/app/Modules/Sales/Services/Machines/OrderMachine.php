<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Machines;

use App\Core\Documents\StateMachine;

/**
 * Progress states (partially_delivered .. invoiced) follow the delivered and invoiced quantities,
 * so they move both ways when a delivery is cancelled or an invoice reversed.
 */
final class OrderMachine extends StateMachine
{
    private const array PROGRESS = ['confirmed', 'partially_delivered', 'delivered', 'partially_invoiced', 'invoiced'];

    protected function transitions(): array
    {
        $map = [
            'draft' => ['pending_approval', 'confirmed', 'cancelled'],
            'pending_approval' => ['confirmed', 'draft', 'cancelled'],
        ];

        foreach (self::PROGRESS as $from) {
            $map[$from] = [...array_values(array_diff(self::PROGRESS, [$from])), 'closed'];
        }

        $map['confirmed'][] = 'cancelled';
        $map['confirmed'][] = 'pending_approval';

        return $map;
    }
}
