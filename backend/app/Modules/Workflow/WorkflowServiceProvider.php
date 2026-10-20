<?php

declare(strict_types=1);

namespace App\Modules\Workflow;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use App\Modules\Workflow\Contracts\ApproverResolver;
use App\Modules\Workflow\Models\ApprovalFlow;
use App\Modules\Workflow\Models\ApprovalRequest;
use App\Modules\Workflow\Policies\ApprovalFlowPolicy;
use App\Modules\Workflow\Policies\ApprovalRequestPolicy;
use App\Modules\Workflow\Services\DatabaseApprovalEngine;
use App\Modules\Workflow\Services\SpatieApproverResolver;
use Illuminate\Support\Facades\Gate;

final class WorkflowServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ApprovalEngine::class, DatabaseApprovalEngine::class);
        $this->app->bind(ApproverResolver::class, SpatieApproverResolver::class);
    }

    public function boot(): void
    {
        parent::boot();
        Gate::policy(ApprovalFlow::class, ApprovalFlowPolicy::class);
        Gate::policy(ApprovalRequest::class, ApprovalRequestPolicy::class);
    }
}
