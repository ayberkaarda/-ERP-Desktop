<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Services;

use App\Core\Documents\HasStatus;
use App\Core\Documents\StateMachine;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

final class ApprovalStateMachine extends StateMachine
{
    protected function transitions(): array
    {
        return ['pending' => ['approved', 'rejected', 'cancelled']];
    }

    protected function afterTransition(Model&HasStatus $model, string $from, string $to, ?Authenticatable $actor): void
    {
        // A request that left "pending" has no active approvers anymore.
        DB::table('approval_request_approvers')->where('request_id', $model->getKey())->delete();
    }
}
