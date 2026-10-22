<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Listeners;

use App\Core\Company\CompanyContext;
use App\Modules\Purchasing\Services\InvoiceService;
use App\Modules\Purchasing\Services\OrderService;
use App\Modules\Purchasing\Services\RequestService;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Events\ApprovalRejected;

/**
 * Approval results of purchase requests, orders and invoices: completed approves (an invoice is
 * booked), rejected sends back (requests become rejected, orders and invoices drafts); the creator
 * is notified either way. Other document types are ignored.
 */
final class ApprovalListener
{
    // Resolved per event inside the event company: nothing retains a company context.

    public function completed(ApprovalCompleted $event): void
    {
        match ($event->documentType) {
            RequestService::APPROVAL_TYPE => app(CompanyContext::class)->runAs($event->companyId, fn () => app(RequestService::class)->approvalCompleted($event->documentId)),
            OrderService::APPROVAL_TYPE => app(CompanyContext::class)->runAs($event->companyId, fn () => app(OrderService::class)->approvalCompleted($event->documentId)),
            InvoiceService::APPROVAL_TYPE => app(CompanyContext::class)->runAs($event->companyId, fn () => app(InvoiceService::class)->approvalCompleted($event->documentId)),
            default => null,
        };
    }

    public function rejected(ApprovalRejected $event): void
    {
        match ($event->documentType) {
            RequestService::APPROVAL_TYPE => app(CompanyContext::class)->runAs($event->companyId, fn () => app(RequestService::class)->approvalRejected($event->documentId)),
            OrderService::APPROVAL_TYPE => app(CompanyContext::class)->runAs($event->companyId, fn () => app(OrderService::class)->approvalRejected($event->documentId)),
            InvoiceService::APPROVAL_TYPE => app(CompanyContext::class)->runAs($event->companyId, fn () => app(InvoiceService::class)->approvalRejected($event->documentId)),
            default => null,
        };
    }
}
