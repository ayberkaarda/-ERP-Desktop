<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Contracts;

use App\Modules\Workflow\Models\ApprovalRequest;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

interface ApprovalEngine
{
    public function start(Model $doc, string $docType, ?string $amount): ApprovalRequest;

    public function decide(ApprovalRequest $r, Authenticatable $actor, string $decision, ?string $comment = null): ApprovalRequest;

    /** @return Builder<ApprovalRequest> */
    public function pendingFor(Authenticatable $user): Builder;

    public function cancel(ApprovalRequest $r, Authenticatable $actor): ApprovalRequest;
}
