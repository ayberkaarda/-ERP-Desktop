<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Machines;

use App\Core\Documents\StateMachine;

final class QuoteMachine extends StateMachine
{
    protected function transitions(): array
    {
        return [
            'draft' => ['sent', 'accepted', 'converted', 'expired', 'cancelled'],
            'sent' => ['accepted', 'rejected', 'converted', 'expired', 'cancelled'],
            'accepted' => ['converted', 'cancelled'],
            'rejected' => ['cancelled'],
            'expired' => ['cancelled'],
        ];
    }
}
