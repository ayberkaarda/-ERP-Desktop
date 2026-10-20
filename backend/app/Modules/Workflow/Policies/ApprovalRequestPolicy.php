<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Policies;

use App\Core\Company\CompanyContext;
use App\Modules\Workflow\Models\ApprovalRequest;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Gate;

final class ApprovalRequestPolicy
{
    public function viewAny(Authenticatable $user): bool
    {
        return Gate::forUser($user)->allows('approvals.view');
    }

    public function view(Authenticatable $user, ApprovalRequest $request): bool
    {
        return $request->company_id === app(CompanyContext::class)->id() && $this->viewAny($user);
    }

    public function decide(Authenticatable $user, ApprovalRequest $request): bool
    {
        $id = (string) $user->getAuthIdentifier();

        return $request->company_id === app(CompanyContext::class)->id()
            && Gate::forUser($user)->allows('approvals.decide')
            && ($request->allow_self_approval || $request->requested_by !== $id)
            && in_array($id, $request->activeStep()['approvers'] ?? [], true);
    }
}
