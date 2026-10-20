<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Services;

use App\Core\Documents\StateMachine;

final class ApprovalStateMachine extends StateMachine
{
    protected function transitions(): array
    {
        return ['pending' => ['approved', 'rejected', 'cancelled']];
    }
}
