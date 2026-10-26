<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Events\PurchaseOrderApproved;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Models\PurchaseRequestLine;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Services\Machines\OrderMachine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Purchase orders: drafts, submission (approval above purchasing.require_approval_over, otherwise
 * approved at once), send to the supplier, revision before any receipt or invoice, cancel and
 * close. Progress states are kept by OrderProgress.
 */
final class OrderService extends DocumentService
{
    public const string APPROVAL_TYPE = 'purchase_order';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly OrderMachine $machine,
        private readonly RequestProgress $requests,
        private readonly RequestService $requestService,
        private readonly ApprovalEngine $approvals,
        private readonly PurchasingSettings $settings,
        private readonly Notifier $notifier,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    public function create(array $data, array $lines, ?Authenticatable $actor, bool $canOverridePrice): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($data, $lines, $actor, $canOverridePrice): PurchaseOrder {
            $composed = $this->compose($data, $lines, $canOverridePrice);

            return $this->store->create(new PurchaseOrder, $composed, self::extraHeader($data), self::lineExtras($lines), self::actorId($actor));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(PurchaseOrder $order, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($order, $data, $lines, $version, $actor, $canOverridePrice): PurchaseOrder {
            $order = $this->lockWithRequest($order);
            $this->assertDraft($order);
            $order->assertVersion($version);
            $this->write($order, $data, $lines, $actor, $canOverridePrice);

            return $order;
        });
    }

    public function delete(PurchaseOrder $order, ?int $version): void
    {
        Purchasing::transaction(function () use ($order, $version): void {
            $order = $this->lockWithRequest($order);

            $this->assertDraft($order);

            if ($version !== null) {
                $order->assertVersion($version);
            }
            $this->assertNoDocuments($order);
            $requestId = $order->request_id;
            $order->delete();
            $this->requests->refresh($requestId);
        });
    }

    /**
     * Number, then pending_approval (total >= threshold) or approved.
     */
    public function submit(PurchaseOrder $order, ?int $version, ?Authenticatable $actor): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($order, $version, $actor): PurchaseOrder {
            $order = $this->lock($order, $version);
            $this->assertStatus($order, [OrderStatus::Draft], OrderStatus::Approved->value);

            return $this->submitLocked($order, $actor);
        });
    }

    /**
     * Rewrites an approved, sent or pending order that has no receipts or invoices and submits it again.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function revise(PurchaseOrder $order, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($order, $data, $lines, $version, $actor, $canOverridePrice): PurchaseOrder {
            $order = $this->lockWithRequest($order);
            $order->assertVersion($version);
            $this->assertStatus($order, [OrderStatus::Approved, OrderStatus::Sent, OrderStatus::PendingApproval], 'revised');
            $this->assertNoDocuments($order);
            $order->revision = $order->revision + 1;
            $order->approved_at = null;
            $order->approved_by = null;
            $this->write($order, $data, $lines, $actor, $canOverridePrice);

            return $this->submitLocked($order, $actor);
        });
    }

    /** Marks the order as sent to the supplier (approved -> sent). */
    public function send(PurchaseOrder $order, ?int $version, ?Authenticatable $actor): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($order, $version, $actor): PurchaseOrder {
            $order = $this->lock($order, $version);
            $this->assertStatus($order, [OrderStatus::Approved, OrderStatus::Sent, OrderStatus::PartiallyReceived], OrderStatus::Sent->value);
            $order->sent_at ??= now();

            if ($order->status === OrderStatus::Approved) {
                return $this->machine->transition($order, OrderStatus::Sent, $actor);
            }

            $order->save();

            return $order;
        });
    }

    public function cancel(PurchaseOrder $order, ?int $version, ?Authenticatable $actor): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($order, $version, $actor): PurchaseOrder {
            $order = $this->lockWithRequest($order);

            if ($version !== null) {
                $order->assertVersion($version);
            }

            $this->assertStatus($order, [OrderStatus::Draft, OrderStatus::PendingApproval, OrderStatus::Approved, OrderStatus::Sent], OrderStatus::Cancelled->value);
            $this->assertNoActiveDocuments($order);
            $order->cancelled_at = now();
            $this->machine->transition($order, OrderStatus::Cancelled, $actor);
            $this->requests->refresh($order->request_id);

            return $order;
        });
    }

    public function close(PurchaseOrder $order, ?int $version, ?Authenticatable $actor): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($order, $version, $actor): PurchaseOrder {
            $order = $this->lock($order, $version);
            $this->assertStatus($order, [...OrderStatus::open(), OrderStatus::Invoiced], OrderStatus::Closed->value);
            $order->closed_at = now();

            return $this->machine->transition($order, OrderStatus::Closed, $actor);
        });
    }

    /** Approval granted (ApprovalCompleted). */
    public function approvalCompleted(string $orderId, string $approvalRequestId): void
    {
        $order = Purchasing::transaction(function () use ($orderId, $approvalRequestId): ?PurchaseOrder {
            $order = PurchaseOrder::query()->whereKey($orderId)->lockForUpdate()->first();

            if ($order === null || $order->status !== OrderStatus::PendingApproval || ! self::isCurrentApproval($order->approval_request_id, $approvalRequestId)) {
                return null;
            }

            return $this->approve($order, null);
        });

        if ($order !== null) {
            $this->notifyCreator($order, 'order_approval_granted');
        }
    }

    /** Approval rejected: back to draft with a comment. */
    public function approvalRejected(string $orderId, string $approvalRequestId): void
    {
        $order = Purchasing::transaction(function () use ($orderId, $approvalRequestId): ?PurchaseOrder {
            $order = PurchaseOrder::query()->whereKey($orderId)->lockForUpdate()->first();

            if ($order === null || $order->status !== OrderStatus::PendingApproval || ! self::isCurrentApproval($order->approval_request_id, $approvalRequestId)) {
                return null;
            }

            $order->approval_comment = Messages::get('approval_rejected_comment');

            return $this->machine->transition($order, OrderStatus::Draft);
        });

        if ($order !== null) {
            $this->notifyCreator($order, 'order_approval_rejected');
        }
    }

    private function submitLocked(PurchaseOrder $order, ?Authenticatable $actor): PurchaseOrder
    {
        if ($order->lines()->count() === 0) {
            Messages::fail('lines', 'lines_required');
        }

        $this->composer->supplier($order->party_id);
        $this->store->assignNumber($order, DocumentKind::Order);
        $order->approval_comment = null;
        $threshold = $this->settings->orderApprovalThreshold();

        if ($threshold !== null && $order->total_local->isGreaterThanOrEqualTo($threshold)) {
            if ($order->status !== OrderStatus::PendingApproval) {
                $this->machine->transition($order, OrderStatus::PendingApproval, $actor);
            } else {
                $order->save();
            }

            // A revision of a pending order replaces its request (Workflow cancels the old one).
            $request = $this->approvals->start($order, self::APPROVAL_TYPE, (string) $order->total_local, (string) $order->revision);
            DB::table('purchase_orders')->where('id', $order->id)->update(['approval_request_id' => $request->getKey()]);
            $order->setRawAttributes([...$order->getAttributes(), 'approval_request_id' => $request->getKey()], true);

            return $order;
        }

        return $this->approve($order, $actor);
    }

    private function approve(PurchaseOrder $order, ?Authenticatable $actor): PurchaseOrder
    {
        $order->approved_at = now();
        $order->approved_by = self::actorId($actor);
        $target = $order->sent_at !== null ? OrderStatus::Sent : OrderStatus::Approved;

        if ($order->status === $target) {
            $order->save();
        } else {
            $this->machine->transition($order, $target, $actor);
        }

        event(new PurchaseOrderApproved($order->company_id, $order->id, (string) $order->number, $order->party_id, (string) $order->total_local));

        return $order;
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    private function write(PurchaseOrder $order, array $data, ?array $lines, ?Authenticatable $actor, bool $canOverridePrice): void
    {
        $stored = $order->lines()->get();
        [$inputs, $kept] = $this->editedLines($stored, $lines);
        $byId = $stored->keyBy('id');

        foreach ($kept as $i => $extra) {
            $old = is_string($extra['id'] ?? null) ? $byId->get($extra['id']) : null;
            $kept[$i] = [...$extra, ...self::lineExtras([$lines[$i] ?? []])[0]];

            if ($old instanceof PurchaseOrderLine) {
                $kept[$i]['request_line_id'] = $old->request_line_id;
                $kept[$i]['rfq_line_id'] = $old->rfq_line_id;
                $kept[$i]['expected_date'] ??= $old->expected_date?->format('Y-m-d');
            }
        }

        $this->assertRequestBounds($order, $inputs, $kept);
        $composed = $this->compose($this->mergedHeader($order, $data), $inputs, $canOverridePrice);
        $this->store->replace($order, $composed, array_intersect_key(self::extraHeader($data), $data), $kept);
        $this->logOverrides($order, $composed, $actor);
        $this->requests->refresh($order->request_id);
    }

    /**
     * Lines taken from a request may not order more than the request line still lacks.
     *
     * @param  list<array<string, mixed>>  $inputs
     * @param  list<array<string, mixed>>  $extras
     */
    private function assertRequestBounds(PurchaseOrder $order, array $inputs, array $extras): void
    {
        foreach ($extras as $i => $extra) {
            $id = is_string($extra['request_line_id'] ?? null) ? $extra['request_line_id'] : null;

            if ($id === null) {
                continue;
            }

            $line = PurchaseRequestLine::query()->whereKey($id)->firstOrFail();
            $qty = Purchasing::dec(is_string($inputs[$i]['quantity'] ?? null) ? $inputs[$i]['quantity'] : '0');
            $this->requestService->assertWithinRequest($line, $qty, "lines.{$i}.quantity", $order->id);
        }
    }

    /** The request (if any) is locked before the order so request bounds cannot race. */
    private function lockWithRequest(PurchaseOrder $order): PurchaseOrder
    {
        $requestId = DB::table('purchase_orders')->where('id', $order->id)->value('request_id');

        if (is_string($requestId)) {
            DB::table('purchase_requests')->where('id', $requestId)->lockForUpdate()->first(['id']);
        }

        return $this->lock($order);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private static function extraHeader(array $data): array
    {
        return [
            'expected_date' => DocumentComposer::str($data['expected_date'] ?? null),
            'supplier_reference' => DocumentComposer::str($data['supplier_reference'] ?? null),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return list<array<string, mixed>>
     */
    private static function lineExtras(array $lines): array
    {
        return array_map(static fn (array $l): array => ['expected_date' => DocumentComposer::str($l['expected_date'] ?? null)], $lines);
    }

    /** Revision and deletion need an order that no receipt or invoice references (any status). */
    private function assertNoDocuments(PurchaseOrder $order): void
    {
        $used = DB::table('purchase_receipts')->where('order_id', $order->id)->exists()
            || DB::table('purchase_invoice_lines as l')->join('purchase_order_lines as o', 'o.id', '=', 'l.order_line_id')->where('o.document_id', $order->id)->exists();

        if ($used) {
            Messages::fail('order', 'order_has_documents');
        }
    }

    /** Cancel needs no receipt or invoice that still counts (drafts must be deleted first). */
    private function assertNoActiveDocuments(PurchaseOrder $order): void
    {
        $used = DB::table('purchase_receipts')->where('order_id', $order->id)->whereIn('status', ['draft', 'posted'])->exists()
            || DB::table('purchase_invoice_lines as l')->join('purchase_order_lines as o', 'o.id', '=', 'l.order_line_id')
                ->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')->where('o.document_id', $order->id)
                ->whereNotIn('i.status', ['cancelled', 'reversed'])->exists();

        if ($used) {
            Messages::fail('order', 'order_has_documents');
        }
    }

    private function notifyCreator(PurchaseOrder $order, string $key): void
    {
        if ($order->created_by === null) {
            return;
        }

        try {
            $this->notifier->notify($order->created_by, 'purchasing.'.$key, [
                'title' => Messages::get($key.'_title', ['number' => (string) $order->number]),
                'body' => Messages::get($key.'_body', ['number' => (string) $order->number]),
                'url' => '/purchasing/orders/'.$order->id,
                'order_id' => $order->id,
            ]);
        } catch (\Throwable $e) {
            Log::warning('purchasing approval notification failed', ['order' => $order->id, 'error' => $e->getMessage()]);
        }
    }
}
