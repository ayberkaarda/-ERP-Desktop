<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Policies;

use App\Core\Company\CompanyContext;
use App\Modules\Workflow\Models\ApprovalFlow;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Gate;

final class ApprovalFlowPolicy
{
    public function viewAny(Authenticatable $user): bool
    {
        return Gate::forUser($user)->allows('approval_flows.manage');
    }

    public function create(Authenticatable $user): bool
    {
        return $this->viewAny($user);
    }

    public function view(Authenticatable $user, ApprovalFlow $flow): bool
    {
        return $flow->company_id === app(CompanyContext::class)->id() && $this->viewAny($user);
    }

    public function update(Authenticatable $user, ApprovalFlow $flow): bool
    {
        return $this->view($user, $flow);
    }

    public function delete(Authenticatable $user, ApprovalFlow $flow): bool
    {
        return $this->view($user, $flow);
    }
}
