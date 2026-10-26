<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Machines;

use App\Core\Documents\StateMachine;

final class ReceiptMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['posted', 'cancelled'],
            'posted' => ['cancelled'],
        ];
    }
}
