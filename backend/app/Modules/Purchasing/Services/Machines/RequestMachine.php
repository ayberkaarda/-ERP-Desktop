<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Machines;

use App\Core\Documents\StateMachine;

/**
 * Request: approval moves pending -> approved/rejected; editing a rejected request reopens it as a
 * draft; ordered states follow the ordered quantities both ways (an order cancelled reopens it).
 */
final class RequestMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['pending_approval', 'approved', 'cancelled'],
            'pending_approval' => ['approved', 'rejected', 'draft', 'cancelled'],
            'rejected' => ['draft', 'cancelled'],
            'approved' => ['partially_ordered', 'ordered', 'cancelled'],
            'partially_ordered' => ['approved', 'ordered', 'cancelled'],
            'ordered' => ['approved', 'partially_ordered'],
        ];
    }
}
