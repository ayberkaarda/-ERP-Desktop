<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Machines;

use App\Core\Documents\StateMachine;

final class DeliveryMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['posted', 'cancelled'],
            'posted' => ['cancelled'],
        ];
    }
}
