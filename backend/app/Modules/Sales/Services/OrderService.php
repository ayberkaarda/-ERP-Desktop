<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Sales\Data\CreditCheck;
use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Events\SalesOrderConfirmed;
use App\Modules\Sales\Exceptions\CreditLimitExceeded;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Services\Composer\DocumentComposer;
use App\Modules\Sales\Services\Machines\OrderMachine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use App\Modules\Sales\Support\SalesSettings;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Orders: drafts, confirmation (credit check, approval above the threshold, stock reservation),
 * revision before any delivery, cancel and close. Progress states are kept by OrderProgress.
 */
final class OrderService extends DocumentService
{
    public const string APPROVAL_TYPE = 'sales_order';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly OrderMachine $machine,
        private readonly CreditControl $credit,
        private readonly OrderReservations $reservations,
        private readonly ApprovalEngine $approvals,
        private readonly SalesSettings $settings,
        private readonly Notifier $notifier,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    public function create(array $data, array $lines, ?Authenticatable $actor, bool $canOverridePrice): SalesOrder
    {
        return Sales::transaction(function () use ($data, $lines, $actor, $canOverridePrice): SalesOrder {
            $composed = $this->compose($data, $lines, $canOverridePrice);
            $order = $this->store->create(new SalesOrder, $composed, [
                'requested_delivery_date' => $data['requested_delivery_date'] ?? null,
            ], actor: self::actorId($actor));
            $this->logOverrides($order, $composed, $actor);

            return $order;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(SalesOrder $order, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): SalesOrder
    {
        return Sales::transaction(function () use ($order, $data, $lines, $version, $actor, $canOverridePrice): SalesOrder {
            $order = $this->lock($order, $version);
            $this->assertDraft($order);
            [$inputs, $kept] = $this->editedLines($order->lines, $lines);
            $composed = $this->compose($this->mergedHeader($order, $data), $inputs, $canOverridePrice);
            $extra = array_key_exists('requested_delivery_date', $data) ? ['requested_delivery_date' => $data['requested_delivery_date']] : [];
            $this->store->replace($order, $composed, $extra, $kept);
            $this->logOverrides($order, $composed, $actor);

            return $order;
        });
    }

    public function delete(SalesOrder $order, ?int $version): void
    {
        Sales::transaction(function () use ($order, $version): void {
            $order = $this->lock($order, $version);
            $this->assertDraft($order);
            $this->assertNoDocuments($order);
            $order->delete();
        });
    }

    /**
     * Credit check, then pending_approval (total >= threshold) or confirmed with reservations.
     *
     * @return array{0: SalesOrder, 1: list<array<string, mixed>>} the order and response warnings
     */
    public function confirm(SalesOrder $order, ?int $version, ?string $overrideReason, bool $canOverride, ?Authenticatable $actor): array
    {
        return Sales::transaction(function () use ($order, $version, $overrideReason, $canOverride, $actor): array {
            $order = $this->lock($order, $version);
            $this->assertStatus($order, [OrderStatus::Draft], OrderStatus::Confirmed->value);

            return $this->submit($order, $overrideReason, $canOverride, $actor);
        });
    }

    /**
     * Rewrites a confirmed order that has no deliveries or invoices: releases its reservations,
     * re-prices nothing that is given, and runs credit, approval and reservation again.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     * @return array{0: SalesOrder, 1: list<array<string, mixed>>}
     */
    public function revise(SalesOrder $order, array $data, ?array $lines, int $version, ?string $overrideReason, bool $canOverride, bool $canOverridePrice, ?Authenticatable $actor): array
    {
        return Sales::transaction(function () use ($order, $data, $lines, $version, $overrideReason, $canOverride, $canOverridePrice, $actor): array {
            $order = $this->lock($order, $version);
            $this->assertStatus($order, [OrderStatus::Confirmed, OrderStatus::PendingApproval], 'revised');
            $this->assertNoDocuments($order);
            $this->reservations->release($order);
            [$inputs, $kept] = $this->editedLines($order->lines, $lines);
            $composed = $this->compose($this->mergedHeader($order, $data), $inputs, $canOverridePrice);
            $extra = ['revision' => $order->revision + 1];

            if (array_key_exists('requested_delivery_date', $data)) {
                $extra['requested_delivery_date'] = $data['requested_delivery_date'];
            }

            $this->store->replace($order, $composed, $extra, $kept);
            $this->logOverrides($order, $composed, $actor);

            return $this->submit($order, $overrideReason, $canOverride, $actor);
        });
    }

    public function cancel(SalesOrder $order, ?int $version, ?Authenticatable $actor): SalesOrder
    {
        return Sales::transaction(function () use ($order, $version, $actor): SalesOrder {
            $order = $this->lock($order, $version);
            $this->assertStatus($order, [OrderStatus::Draft, OrderStatus::PendingApproval, OrderStatus::Confirmed], OrderStatus::Cancelled->value);
            $this->assertNoActiveDocuments($order);
            $this->reservations->release($order);
            $order->cancelled_at = now();

            return $this->machine->transition($order, OrderStatus::Cancelled, $actor);
        });
    }

    public function close(SalesOrder $order, ?int $version, ?Authenticatable $actor): SalesOrder
    {
        return Sales::transaction(function () use ($order, $version, $actor): SalesOrder {
            $order = $this->lock($order, $version);
            $this->assertStatus($order, [...OrderStatus::open(), OrderStatus::Invoiced], OrderStatus::Closed->value);
            $this->reservations->release($order);
            $order->closed_at = now();

            return $this->machine->transition($order, OrderStatus::Closed, $actor);
        });
    }

    /** Approval granted (ApprovalCompleted): confirm and reserve; a reservation the stock cannot cover is skipped. */
    public function approvalCompleted(string $orderId): void
    {
        $result = Sales::transaction(function () use ($orderId): ?array {
            $order = SalesOrder::query()->whereKey($orderId)->lockForUpdate()->first();

            if ($order === null || $order->status !== OrderStatus::PendingApproval) {
                return null;
            }

            // Exposure may have grown while the order waited: check again under the party's credit
            // lock; over the limit in block mode only an override authorized at submission passes.
            try {
                $party = $this->composer->party($order->party_id);
                $check = $this->credit->check($order->company_id, $party, (string) $order->total_local, $order->id, '0',
                    $order->credit_override_reason, $order->credit_override_by !== null);
            } catch (CreditLimitExceeded|ValidationException) {
                $order->approval_comment = Messages::get('approval_credit_blocked');
                $this->machine->transition($order, OrderStatus::Draft);

                return [$order, 'approval_credit_blocked'];
            }

            if ($check !== null && $check->overridden) {
                activity()->performedOn($order)->withProperties(['reason' => $order->credit_override_reason, 'check' => $check->toArray(), 'at' => 'approval'])
                    ->event('credit_override')->log('credit_override');
            }

            $this->finalize($order, null, tolerateShortage: true);

            return [$order, 'approval_granted'];
        });

        if ($result !== null) {
            $this->notifyCreator($result[0], $result[1]);
        }
    }

    /** Approval rejected: back to draft. */
    public function approvalRejected(string $orderId): void
    {
        $order = Sales::transaction(function () use ($orderId): ?SalesOrder {
            $order = SalesOrder::query()->whereKey($orderId)->lockForUpdate()->first();

            if ($order === null || $order->status !== OrderStatus::PendingApproval) {
                return null;
            }

            $order->approval_comment = Messages::get('approval_rejected_comment');

            return $this->machine->transition($order, OrderStatus::Draft);
        });

        if ($order !== null) {
            $this->notifyCreator($order, 'approval_rejected');
        }
    }

    /**
     * @return array{0: SalesOrder, 1: list<array<string, mixed>>}
     */
    private function submit(SalesOrder $order, ?string $overrideReason, bool $canOverride, ?Authenticatable $actor): array
    {
        if ($order->lines()->count() === 0) {
            Messages::fail('lines', 'lines_required');
        }

        $party = $this->composer->party($order->party_id);
        $check = $this->credit->check($order->company_id, $party, (string) $order->total_local, $order->id, '0', $overrideReason, $canOverride);
        $this->recordOverride($order, $check, $overrideReason, $actor);
        $warning = CreditControl::warning($check);
        $warnings = $warning === null ? [] : [$warning];
        $this->store->assignNumber($order, DocumentKind::Order);
        $threshold = $this->settings->approvalThreshold();

        if ($threshold !== null && $order->total_local->isGreaterThanOrEqualTo($threshold)) {
            if ($order->status !== OrderStatus::PendingApproval) {
                $this->machine->transition($order, OrderStatus::PendingApproval, $actor);
            }

            // A revision of a pending order replaces its request (Workflow cancels the old one).
            $request = $this->approvals->start($order, self::APPROVAL_TYPE, (string) $order->total_local, (string) $order->revision);
            DB::table('sales_orders')->where('id', $order->id)->update(['approval_request_id' => $request->getKey()]);
            $order->setRawAttributes([...$order->getAttributes(), 'approval_request_id' => $request->getKey()], true);

            return [$order, $warnings];
        }

        return [$order, [...$warnings, ...$this->finalize($order, $actor)]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function finalize(SalesOrder $order, ?Authenticatable $actor, bool $tolerateShortage = false): array
    {
        $warnings = [];

        if ($this->settings->reserveOnConfirm()) {
            try {
                $warnings = Sales::transaction(fn (): array => $this->reservations->reserve($order, self::actorId($actor)));
            } catch (ValidationException $e) {
                if (! $tolerateShortage) {
                    throw $e;
                }

                Log::warning('sales order confirmed without reservation', ['order' => $order->id, 'errors' => $e->errors()]);
                $warnings[] = ['code' => 'sales.reservation_failed', 'message' => Messages::get('reservation_failed')];
            }
        }

        $order->confirmed_at = now();
        $order->confirmed_by = self::actorId($actor);

        if ($order->status === OrderStatus::Confirmed) {
            // A revision of a confirmed order stays confirmed.
            $order->save();
        } else {
            $this->machine->transition($order, OrderStatus::Confirmed, $actor);
        }

        event(new SalesOrderConfirmed($order->company_id, $order->id, (string) $order->number, $order->party_id, (string) $order->total_local));

        return $warnings;
    }

    private function recordOverride(SalesOrder $order, ?CreditCheck $check, ?string $reason, ?Authenticatable $actor): void
    {
        if ($check === null || ! $check->overridden) {
            return;
        }

        $order->credit_override_reason = $reason;
        $order->credit_override_by = self::actorId($actor);
        activity()->performedOn($order)->causedBy(self::causer($actor))->withProperties(['reason' => $reason, 'check' => $check->toArray()])
            ->event('credit_override')->log('credit_override');
    }

    /** Revision and deletion need an order that no delivery or invoice references (any status). */
    private function assertNoDocuments(SalesOrder $order): void
    {
        $used = DB::table('sales_deliveries')->where('order_id', $order->id)->exists()
            || DB::table('sales_invoice_lines as l')->join('sales_order_lines as o', 'o.id', '=', 'l.order_line_id')->where('o.document_id', $order->id)->exists();

        if ($used) {
            Messages::fail('order', 'order_has_documents');
        }
    }

    /** Cancel needs no delivery or invoice that still counts (drafts must be deleted first). */
    private function assertNoActiveDocuments(SalesOrder $order): void
    {
        $used = DB::table('sales_deliveries')->where('order_id', $order->id)->whereIn('status', ['draft', 'posted'])->exists()
            || DB::table('sales_invoice_lines as l')->join('sales_order_lines as o', 'o.id', '=', 'l.order_line_id')
                ->join('sales_invoices as i', 'i.id', '=', 'l.document_id')->where('o.document_id', $order->id)
                ->whereNotIn('i.status', ['cancelled', 'reversed'])->exists();

        if ($used) {
            Messages::fail('order', 'order_has_documents');
        }
    }

    private function notifyCreator(SalesOrder $order, string $key): void
    {
        if ($order->created_by === null) {
            return;
        }

        try {
            $this->notifier->notify($order->created_by, 'sales.order_'.$key, [
                'title' => Messages::get($key.'_title', ['number' => (string) $order->number]),
                'body' => Messages::get($key.'_body', ['number' => (string) $order->number]),
                'url' => '/sales/orders/'.$order->id,
                'order_id' => $order->id,
            ]);
        } catch (\Throwable $e) {
            Log::warning('sales approval notification failed', ['order' => $order->id, 'error' => $e->getMessage()]);
        }
    }
}
