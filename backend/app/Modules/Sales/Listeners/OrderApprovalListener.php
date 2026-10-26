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
    // Resolved per event inside the event company: nothing retains a company context.

    public function completed(ApprovalCompleted $event): void
    {
        if ($event->documentType === OrderService::APPROVAL_TYPE) {
            app(CompanyContext::class)->runAs($event->companyId, fn () => app(OrderService::class)->approvalCompleted($event->documentId));
        }
    }

    public function rejected(ApprovalRejected $event): void
    {
        if ($event->documentType === OrderService::APPROVAL_TYPE) {
            app(CompanyContext::class)->runAs($event->companyId, fn () => app(OrderService::class)->approvalRejected($event->documentId));
        }
    }
}
