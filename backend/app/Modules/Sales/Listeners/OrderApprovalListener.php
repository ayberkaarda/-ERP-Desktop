<?php

declare(strict_types=1);

namespace App\Modules\Sales\Listeners;

use App\Core\Company\CompanyContext;
use App\Modules\Sales\Services\OrderService;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Events\ApprovalRejected;

/**
 * Approval results of sales orders: completed confirms (and reserves), rejected returns to draft;
 * the creator is notified either way. Other document types are ignored.
 */
final class OrderApprovalListener
{
    public function __construct(
        private readonly OrderService $orders,
        private readonly CompanyContext $company,
    ) {}

    public function completed(ApprovalCompleted $event): void
    {
        if ($event->documentType === OrderService::APPROVAL_TYPE) {
            $this->company->runAs($event->companyId, fn () => $this->orders->approvalCompleted($event->documentId));
        }
    }

    public function rejected(ApprovalRejected $event): void
    {
        if ($event->documentType === OrderService::APPROVAL_TYPE) {
            $this->company->runAs($event->companyId, fn () => $this->orders->approvalRejected($event->documentId));
        }
    }
}
