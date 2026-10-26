<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Company\CompanyContext;
use App\Core\Documents\VersionConflictException;
use App\Core\Http\ApiException;
use App\Core\Money\RoundingPolicy;
use App\Modules\Accounting\Contracts\PeriodGuard;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Enums\MatchMode;
use App\Modules\Purchasing\Enums\MatchStatus;
use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Events\PurchaseInvoiceBooked;
use App\Modules\Purchasing\Events\PurchaseInvoiceReversed;
use App\Modules\Purchasing\Exceptions\MatchFailed;
use App\Modules\Purchasing\Exceptions\SourcesChanged;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseInvoiceLine;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseReceiptLine;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Services\Composer\Composed;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Services\Machines\InvoiceMachine;
use App\Modules\Purchasing\Services\Machines\ReturnMachine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use Brick\Math\BigDecimal;
use Closure;
use DateTimeImmutable;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Supplier invoices and debit notes. Lines reference receipt lines (bounded by what was received
 * and not yet invoiced or returned), order lines (services, or goods with receive_on_invoice, which
 * posts a receipt at booking) or nothing (direct lines). Sources are locked in a fixed order
 * (orders, receipts, then the invoice) so concurrent conversions serialize. Booking runs the
 * three-way match, the approval threshold, assigns the gapless number and books the journal in one
 * transaction; booked invoices are corrected only by reverse or a return with its debit note.
 */
final class InvoiceService extends DocumentService
{
    /** Attempts of a transaction whose invoice sources changed between the read and the lock. */
    private const int SOURCE_ATTEMPTS = 3;

    public const string APPROVAL_TYPE = 'purchase_invoice';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly InvoiceMachine $machine,
        private readonly ReturnMachine $returns,
        private readonly InvoiceJournal $journal,
        private readonly ThreeWayMatch $matcher,
        private readonly PostingService $posting,
        private readonly PeriodGuard $periods,
        private readonly OrderProgress $progress,
        private readonly Quantities $quantities,
        private readonly ReceiptService $receipts,
        private readonly ApprovalEngine $approvals,
        private readonly PurchasingSettings $settings,
        private readonly Notifier $notifier,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines  direct lines and/or lines with receipt_line_id / order_line_id
     */
    public function create(array $data, array $lines, ?Authenticatable $actor, bool $canOverridePrice): PurchaseInvoice
    {
        return Purchasing::transaction(function () use ($data, $lines, $actor, $canOverridePrice): PurchaseInvoice {
            $receive = (bool) ($data['receive_on_invoice'] ?? false);
            $this->lockSources($lines);
            [$inputs, $extras, $currencies] = $this->sourceLines($lines, $receive, null, (string) ($data['party_id'] ?? ''));
            $composed = $this->compose($data, $inputs, $canOverridePrice);
            $this->assertCurrencies($currencies, (string) $composed->header['currency_code']);
            $this->assertReceivable($composed->lines, $extras, $receive);
            $number = $this->supplierNumber($data);
            $this->assertSupplierNumber($composed->header['party_id'], $number, null);
            $invoice = $this->store->create(new PurchaseInvoice, $composed, [
                ...$this->headerExtras($extras), 'receive_on_invoice' => $receive, 'supplier_invoice_no' => $number,
            ], $extras, self::actorId($actor));
            $this->logOverrides($invoice, $composed, $actor);
            $this->storeMatch($invoice);

            return $invoice;
        });
    }

    /**
     * Invoice of a posted receipt: the given lines (receipt_line_id, quantity, unit_price) or all that is still open.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function createFromReceipt(PurchaseReceipt $receipt, array $data, ?array $lines, ?Authenticatable $actor, bool $canOverridePrice): PurchaseInvoice
    {
        return Purchasing::transaction(function () use ($receipt, $data, $lines, $actor, $canOverridePrice): PurchaseInvoice {
            if ($receipt->order_id !== null) {
                $this->lockOrders([$receipt->order_id]);
            }

            $receipt = $this->lock($receipt);

            if ($receipt->status !== ReceiptStatus::Posted) {
                Messages::fail('receipt', 'receipt_not_posted');
            }

            if ($lines === null) {
                $lines = [];

                foreach ($receipt->lines()->get() as $line) {
                    $open = $this->quantities->openOnReceipt($line->id, $line->quantity);

                    if ($open->isPositive()) {
                        $lines[] = ['receipt_line_id' => $line->id, 'quantity' => (string) $open];
                    }
                }
            } else {
                $ids = $receipt->lines()->pluck('id')->all();

                foreach ($lines as $i => $line) {
                    if (! in_array($line['receipt_line_id'] ?? null, $ids, true)) {
                        Messages::fail("lines.{$i}.receipt_line_id", 'source_line_unknown');
                    }
                }
            }

            if ($lines === []) {
                Messages::fail('lines', 'nothing_to_invoice');
            }

            [$inputs, $extras] = $this->sourceLines($lines, false, null, $receipt->party_id);
            $composed = $this->compose($this->convertedHeader($receipt, $data), $inputs, $canOverridePrice);
            $number = $this->supplierNumber($data);
            $this->assertSupplierNumber($receipt->party_id, $number, null);
            $invoice = $this->store->create(new PurchaseInvoice, $composed, [
                'receipt_id' => $receipt->id, 'order_id' => $receipt->order_id, 'source_type' => 'purchase_receipt', 'source_id' => $receipt->id,
                'supplier_invoice_no' => $number,
            ], $extras, self::actorId($actor));
            $this->logOverrides($invoice, $composed, $actor);
            $this->storeMatch($invoice);

            return $invoice;
        });
    }

    /**
     * Invoice of an order: lines (order_line_id, quantity, unit_price) or everything invoiceable.
     * Stock lines are taken from posted receipt lines of the order that are still open unless
     * receive_on_invoice, which invoices the rest against the order line and receives it at booking.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function createFromOrder(PurchaseOrder $order, array $data, ?array $lines, ?Authenticatable $actor, bool $canOverridePrice): PurchaseInvoice
    {
        return Purchasing::transaction(function () use ($order, $data, $lines, $actor, $canOverridePrice): PurchaseInvoice {
            $receive = (bool) ($data['receive_on_invoice'] ?? false);
            $order = $this->lockOrders([$order->id])[$order->id];

            if (! in_array($order->status, OrderStatus::open(), true)) {
                Messages::fail('order', 'order_not_open');
            }

            $orderLines = $order->lines()->get()->keyBy('id');
            $picked = [];

            if ($lines === null) {
                foreach ($orderLines as $line) {
                    $picked[] = ['order_line_id' => $line->id, 'quantity' => null, 'unit_price' => null];
                }
            } else {
                foreach ($lines as $i => $line) {
                    if (! $orderLines->has((string) ($line['order_line_id'] ?? ''))) {
                        Messages::fail("lines.{$i}.order_line_id", 'source_line_unknown');
                    }

                    $picked[] = ['order_line_id' => (string) $line['order_line_id'], 'quantity' => (string) $line['quantity'], 'index' => $i,
                        'unit_price' => is_string($line['unit_price'] ?? null) ? $line['unit_price'] : null];
                }
            }

            $resolved = [];

            foreach ($picked as $pick) {
                /** @var PurchaseOrderLine $orderLine */
                $orderLine = $orderLines->get($pick['order_line_id']);
                $field = isset($pick['index']) ? "lines.{$pick['index']}.quantity" : 'lines';

                foreach ($this->allocateOrderLine($orderLine, $pick['quantity'], $receive, $field) as $row) {
                    $resolved[] = [...$row, 'unit_price' => $pick['unit_price']];
                }
            }

            if ($resolved === []) {
                Messages::fail('lines', 'nothing_to_invoice');
            }

            $this->lockSources($resolved);
            [$inputs, $extras] = $this->sourceLines($resolved, $receive, null, $order->party_id);
            $composed = $this->compose($this->convertedHeader($order, $data), $inputs, $canOverridePrice);
            $number = $this->supplierNumber($data);
            $this->assertSupplierNumber($order->party_id, $number, null);
            $invoice = $this->store->create(new PurchaseInvoice, $composed, [
                'order_id' => $order->id, 'source_type' => 'purchase_order', 'source_id' => $order->id, 'receive_on_invoice' => $receive,
                'supplier_invoice_no' => $number,
            ], $extras, self::actorId($actor));
            $this->logOverrides($invoice, $composed, $actor);
            $this->storeMatch($invoice);

            return $invoice;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(PurchaseInvoice $invoice, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): PurchaseInvoice
    {
        return $this->withSources(function () use ($invoice, $data, $lines, $version, $actor, $canOverridePrice): PurchaseInvoice {
            [$invoice] = $this->lockWithSources($invoice, $lines ?? []);
            $lines ??= $this->linesAsInput($invoice);
            $this->assertDraft($invoice);
            $invoice->assertVersion($version);

            if ($invoice->isDebitNote()) {
                Messages::fail('document', 'debit_note_not_editable');
            }

            $receive = array_key_exists('receive_on_invoice', $data) ? (bool) $data['receive_on_invoice'] : $invoice->receive_on_invoice;
            $header = $this->mergedHeader($invoice, $data);
            [$inputs, $extras, $currencies] = $this->sourceLines($lines, $receive, $invoice->id, (string) $header['party_id']);
            $composed = $this->compose($header, $inputs, $canOverridePrice);
            $this->assertCurrencies($currencies, (string) $composed->header['currency_code']);
            $this->assertReceivable($composed->lines, $extras, $receive);
            $number = array_key_exists('supplier_invoice_no', $data) ? $this->supplierNumber($data) : $invoice->supplier_invoice_no;
            $this->assertSupplierNumber($composed->header['party_id'], $number, $invoice->id);
            $this->store->replace($invoice, $composed, ['receive_on_invoice' => $receive, 'supplier_invoice_no' => $number], $extras);
            $this->logOverrides($invoice, $composed, $actor);
            $this->storeMatch($invoice);

            return $invoice;
        });
    }

    public function delete(PurchaseInvoice $invoice, ?int $version): void
    {
        $this->withSources(function () use ($invoice, $version): void {
            [$invoice] = $this->lockWithSources($invoice);
            $this->assertDraft($invoice);
            if ($version !== null) {
                $invoice->assertVersion($version);
            }

            $invoice->delete();
        });
    }

    public function cancel(PurchaseInvoice $invoice, ?int $version, ?Authenticatable $actor): PurchaseInvoice
    {
        return $this->withSources(function () use ($invoice, $version, $actor): PurchaseInvoice {
            [$invoice] = $this->lockWithSources($invoice);

            if ($version !== null) {
                $invoice->assertVersion($version);
            }

            $this->assertStatus($invoice, [InvoiceStatus::Draft, InvoiceStatus::PendingApproval], InvoiceStatus::Cancelled->value);

            return $this->machine->transition($invoice, InvoiceStatus::Cancelled, $actor);
        });
    }

    /**
     * Books once: match, approval (above the threshold the invoice goes pending and is booked by
     * the approval), automatic receipt of receive_on_invoice goods, number, journal and order
     * progress in one transaction. A booked invoice is returned unchanged.
     *
     * @return array{0: PurchaseInvoice, 1: bool, 2: list<array<string, mixed>>} invoice, replayed, warnings
     */
    public function book(PurchaseInvoice $invoice, ?int $version, ?string $overrideReason, bool $canOverride, ?Authenticatable $actor): array
    {
        return $this->withSources(function () use ($invoice, $version, $overrideReason, $canOverride, $actor): array {
            [$invoice, $orders] = $this->lockWithSources($invoice);

            if (in_array($invoice->status->value, InvoiceStatus::booked(), true) || $invoice->status === InvoiceStatus::Reversed) {
                return [$invoice, true, []];
            }

            if ($version !== null) {
                $invoice->assertVersion($version);
            }

            $this->assertStatus($invoice, [InvoiceStatus::Draft], InvoiceStatus::Booked->value);

            return $this->bookLocked($invoice, $orders, $overrideReason, $canOverride, $actor, false);
        });
    }

    /**
     * The match of an invoice: stored when it was booked, computed now for drafts.
     *
     * @return array<string, mixed>
     */
    public function match(PurchaseInvoice $invoice): array
    {
        if ($invoice->isDebitNote()) {
            return ['mode' => $this->settings->matchMode()->value, 'status' => null, 'lines' => []];
        }

        if (in_array($invoice->status->value, [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value], true)) {
            $lines = [];

            foreach ($invoice->lines()->get() as $line) {
                $lines[] = ['invoice_line_id' => $line->id, 'status' => $line->match_status, ...($line->match_details ?? [])];
            }

            return [
                'mode' => $this->settings->matchMode()->value, 'status' => $invoice->match_status, 'lines' => $lines,
                'override_reason' => $invoice->match_override_reason, 'override_by' => $invoice->match_override_by,
            ];
        }

        return [
            ...ThreeWayMatch::breakdown($this->matcher->evaluate($invoice, $invoice->lines()->get()), $this->settings->matchMode()->value),
            'override_reason' => $invoice->match_override_reason, 'override_by' => $invoice->match_override_by,
        ];
    }

    /**
     * Reverses the journal entry (and with $reverseStock the receipts this invoice posted itself).
     *
     * @return array{0: PurchaseInvoice, 1: bool}
     */
    public function reverse(PurchaseInvoice $invoice, ?int $version, string $date, string $reason, bool $reverseStock, ?Authenticatable $actor): array
    {
        return $this->withSources(function () use ($invoice, $version, $date, $reason, $reverseStock, $actor): array {
            [$invoice, $orders] = $this->lockWithSources($invoice);

            if ($invoice->status === InvoiceStatus::Reversed) {
                return [$invoice, true];
            }

            if ($version !== null) {
                $invoice->assertVersion($version);
            }

            $this->assertStatus($invoice, [InvoiceStatus::Booked], InvoiceStatus::Reversed->value);
            $reason = trim($reason);

            if ($reason === '') {
                Messages::fail('reason', 'reason_required');
            }

            if ($date < $invoice->document_date->format('Y-m-d')) {
                Messages::fail('date', 'reverse_before_document');
            }

            if (! $invoice->paid_amount->isZero()) {
                Messages::fail('document', 'invoice_has_payments');
            }

            if (! $invoice->isDebitNote() && DB::table('purchase_returns')->where('invoice_id', $invoice->id)->where('status', '<>', ReturnStatus::Cancelled->value)->exists()) {
                Messages::fail('document', 'invoice_has_returns');
            }

            $this->periods->assertOpen($invoice->company_id, new DateTimeImmutable($date));
            $lines = $invoice->lines()->get();
            $entry = $this->posting->reverse((string) $invoice->journal_entry_id, new DateTimeImmutable($date), $reason);
            $stockReversed = $reverseStock && $this->reverseReceipts($invoice, $date, $reason, $actor);

            if (! $invoice->isDebitNote()) {
                $this->applyToOrders($lines, $orders, -1, $actor);
            }

            if ($invoice->return_id !== null) {
                $return = PurchaseReturn::query()->whereKey($invoice->return_id)->lockForUpdate()->first();

                if ($return !== null && $return->status === ReturnStatus::Debited) {
                    $return->debit_invoice_id = null;
                    $return->debited_at = null;
                    $this->returns->transition($return, ReturnStatus::Shipped, $actor);
                }
            }

            $invoice->setAttribute('balance_due', '0');
            $invoice->reversed_at = now();
            $invoice->reversed_by = self::actorId($actor);
            $invoice->reversal_date = Carbon::parse($date);
            $invoice->reversal_reason = $reason;
            $invoice->reversal_journal_entry_id = $entry->id;
            $this->machine->transition($invoice, InvoiceStatus::Reversed, $actor);
            event(new PurchaseInvoiceReversed($invoice->company_id, $invoice->id, (string) $invoice->number, $entry->id, $stockReversed));

            return [$invoice, false];
        });
    }

    /**
     * Debit note of a shipped return, booked at once (rates and prices of the original invoice).
     */
    public function debitReturn(PurchaseReturn $return, PurchaseInvoice $original, ?Authenticatable $actor): PurchaseInvoice
    {
        $inputs = [];
        $extras = [];
        $originalLines = $original->lines()->get()->keyBy('id');

        foreach ($return->lines()->get() as $line) {
            /** @var PurchaseInvoiceLine $source */
            $source = $originalLines->get($line->invoice_line_id);
            // The accrual is cleared in the warehouse the goods left from, as the shipment booked it.
            $warehouse = $line->receipt_line_id === null ? $source->warehouse_id
                : ($return->warehouse_id ?? PurchaseReceipt::query()->whereKey(PurchaseReceiptLine::query()->whereKey($line->receipt_line_id)->value('document_id'))->value('warehouse_id'));
            $inputs[] = [...$this->fixedLine($source, (string) $line->quantity, true), 'source_line_id' => $line->id, 'warehouse_id' => $warehouse];
            $extras[] = ['original_line_id' => $source->id, 'receipt_line_id' => $line->receipt_line_id];
        }

        $header = $this->mergedHeader($original, ['document_date' => $return->document_date->format('Y-m-d')]);
        $header['fx_rate'] = (string) $original->fx_rate;
        $header['due_date'] = $return->document_date->format('Y-m-d');
        $composed = $this->allocateDebit($this->compose($header, $inputs, true), $extras, $originalLines->all(), (string) $original->fx_rate);
        $debit = $this->store->create(new PurchaseInvoice, $composed, [
            'invoice_type' => InvoiceType::Return->value, 'original_invoice_id' => $original->id, 'return_id' => $return->id,
            'order_id' => $original->order_id, 'source_type' => 'purchase_return', 'source_id' => $return->id,
        ], $extras, self::actorId($actor));
        [$debit] = $this->bookLocked($this->lock($debit), [], null, false, $actor, false);

        return $debit;
    }

    /** Approval granted (ApprovalCompleted): book with the override recorded at submission. */
    public function approvalCompleted(string $invoiceId, string $approvalRequestId): void
    {
        $result = null;

        try {
            $result = $this->withSources(function () use ($invoiceId, $approvalRequestId): ?PurchaseInvoice {
                $invoice = PurchaseInvoice::query()->whereKey($invoiceId)->first();

                if ($invoice === null || $invoice->status !== InvoiceStatus::PendingApproval || ! self::isCurrentApproval($invoice->approval_request_id, $approvalRequestId)) {
                    return null;
                }

                [$invoice, $orders] = $this->lockWithSources($invoice);

                if ($invoice->status !== InvoiceStatus::PendingApproval || ! self::isCurrentApproval($invoice->approval_request_id, $approvalRequestId)) {
                    return null;
                }

                $invoice->approved_at = now();
                [$invoice] = $this->bookLocked($invoice, $orders, null, false, null, true);

                return $invoice;
            });
        } catch (VersionConflictException $e) {
            // The sources kept changing under the lock (withSources gave up): a transient race, not a
            // booking failure. No fallback to draft; the approval sees the error and can be retried.
            throw $e;
        } catch (ValidationException|MatchFailed|ApiException $e) {
            // The invoice can no longer be booked (period closed, sources changed, match block): back to draft.
            Log::info('purchase invoice approval could not book', ['invoice' => $invoiceId, 'error' => $e->getMessage()]);
            $invoice = $this->withSources(function () use ($invoiceId, $approvalRequestId): ?PurchaseInvoice {
                $invoice = $this->lockPending($invoiceId);

                if ($invoice === null || $invoice->status !== InvoiceStatus::PendingApproval || ! self::isCurrentApproval($invoice->approval_request_id, $approvalRequestId)) {
                    return null;
                }

                $invoice->approval_comment = Messages::get('approval_booking_failed');

                return $this->machine->transition($invoice, InvoiceStatus::Draft);
            });

            if ($invoice !== null) {
                $this->notifyCreator($invoice, 'invoice_approval_failed');
            }

            return;
        }

        if ($result !== null) {
            $this->notifyCreator($result, 'invoice_approval_granted');
        }
    }

    /** Approval rejected: back to draft with a comment. */
    public function approvalRejected(string $invoiceId, string $approvalRequestId): void
    {
        $invoice = $this->withSources(function () use ($invoiceId, $approvalRequestId): ?PurchaseInvoice {
            $invoice = $this->lockPending($invoiceId);

            if ($invoice === null || $invoice->status !== InvoiceStatus::PendingApproval || ! self::isCurrentApproval($invoice->approval_request_id, $approvalRequestId)) {
                return null;
            }

            $invoice->approval_comment = Messages::get('approval_rejected_comment');

            return $this->machine->transition($invoice, InvoiceStatus::Draft);
        });

        if ($invoice !== null) {
            $this->notifyCreator($invoice, 'invoice_approval_rejected');
        }
    }

    /**
     * @param  array<string, PurchaseOrder>  $orders
     * @return array{0: PurchaseInvoice, 1: bool, 2: list<array<string, mixed>>}
     */
    private function bookLocked(PurchaseInvoice $invoice, array $orders, ?string $overrideReason, bool $canOverride, ?Authenticatable $actor, bool $approved): array
    {
        $lines = $invoice->lines()->get();

        if ($lines->isEmpty()) {
            Messages::fail('lines', 'lines_required');
        }

        if (! $invoice->total->isPositive()) {
            Messages::fail('lines', 'invoice_total_zero');
        }

        $this->composer->supplier($invoice->party_id);
        $this->periods->assertOpen($invoice->company_id, new DateTimeImmutable($invoice->document_date->format('Y-m-d')));
        $warnings = [];

        if (! $invoice->isDebitNote()) {
            if ($invoice->supplier_invoice_no === null) {
                Messages::fail('supplier_invoice_no', 'supplier_invoice_no_required');
            }

            $this->assertSupplierNumber($invoice->party_id, $invoice->supplier_invoice_no, $invoice->id);
            $this->recheckBounds($invoice);
            $match = $this->storeMatch($invoice);
            $lines = $invoice->lines()->get();
            $mode = $this->settings->matchMode();

            if ($match['status']->isVariance() && $mode === MatchMode::Block) {
                $own = $overrideReason !== null && trim($overrideReason) !== '' && $canOverride;

                if ($own) {
                    $invoice->match_override_reason = $overrideReason;
                    $invoice->match_override_by = self::actorId($actor);
                    activity()->performedOn($invoice)->causedBy(self::causer($actor))
                        ->withProperties(['reason' => $overrideReason, 'match' => ThreeWayMatch::breakdown($match, $mode->value)])
                        ->event('match_override')->log('match_override');
                } elseif (! ($approved && $invoice->match_override_reason !== null && $invoice->match_override_by !== null)) {
                    throw new MatchFailed(ThreeWayMatch::breakdown($match, $mode->value));
                }
            }

            if ($match['status']->isVariance() && $mode === MatchMode::Warn) {
                $warnings[] = ['code' => 'purchasing.match_variance', 'message' => Messages::get('match_variance'), 'details' => ThreeWayMatch::breakdown($match, $mode->value)];
            }

            $threshold = $this->settings->invoiceApprovalThreshold();

            if (! $approved && $threshold !== null && $invoice->total_local->isGreaterThanOrEqualTo($threshold)) {
                $this->machine->transition($invoice, InvoiceStatus::PendingApproval, $actor);
                $request = $this->approvals->start($invoice, self::APPROVAL_TYPE, (string) $invoice->total_local);
                DB::table('purchase_invoices')->where('id', $invoice->id)->update(['approval_request_id' => $request->getKey()]);
                $invoice->setRawAttributes([...$invoice->getAttributes(), 'approval_request_id' => $request->getKey()], true);

                return [$invoice, false, [...$warnings, ['code' => 'purchasing.approval_pending', 'message' => Messages::get('approval_pending')]]];
            }

            $this->receivePending($invoice, $lines, $orders, $actor);
            $lines = $invoice->lines()->get();
        }

        $this->store->assignNumber($invoice, $invoice->numberKind());
        $this->journal->allocate($invoice, $lines);
        $lines = $invoice->lines()->get();
        $entry = $this->journal->post($invoice, $lines, self::actorId($actor));

        if (! $invoice->isDebitNote()) {
            $this->applyToOrders($lines, $orders, 1, $actor);
        }

        $invoice->journal_entry_id = $entry->id;
        $invoice->setAttribute('paid_amount', '0');
        $invoice->setAttribute('balance_due', (string) $invoice->payable());
        $invoice->booked_at = now();
        $invoice->booked_by = self::actorId($actor);
        $this->machine->transition($invoice, InvoiceStatus::Booked, $actor);
        event(new PurchaseInvoiceBooked($invoice->company_id, $invoice->id, (string) $invoice->number, $invoice->invoice_type->value,
            $invoice->party_id, $entry->id, (string) $invoice->total_local));

        return [$invoice, false, $warnings];
    }

    /**
     * Computes the three-way match of a purchase invoice and stores it on its lines and header.
     *
     * @return array{status: MatchStatus, lines: array<string, array{status: MatchStatus, details: array<string, mixed>}>}
     */
    private function storeMatch(PurchaseInvoice $invoice): array
    {
        $lines = $invoice->lines()->get();
        $result = $this->matcher->evaluate($invoice, $lines);

        foreach ($lines as $line) {
            $r = $result['lines'][$line->id] ?? null;
            $line->match_status = $r['status']->value ?? null;
            $line->match_details = $r['details'] ?? null;
            $line->save();
        }

        $invoice->match_status = $result['status']->value;

        if ($invoice->isDirty('match_status')) {
            $invoice->save();
        }

        return $result;
    }

    /**
     * Posts a receipt for stock lines without one (receive_on_invoice), grouped by order.
     *
     * @param  Collection<int, PurchaseInvoiceLine>  $lines
     * @param  array<string, PurchaseOrder>  $orders
     */
    private function receivePending(PurchaseInvoice $invoice, Collection $lines, array $orders, ?Authenticatable $actor): void
    {
        $groups = [];
        $orderOfLine = $this->orderIdsOfLines($lines);

        foreach ($lines as $line) {
            if ($line->item_type !== 'stock' || $line->receipt_line_id !== null) {
                continue;
            }

            if (! $invoice->receive_on_invoice) {
                Messages::fail('receive_on_invoice', 'invoice_requires_receipt');
            }

            $groups[$orderOfLine[$line->id] ?? ''][] = $line;
        }

        foreach ($groups as $orderId => $group) {
            $order = $orderId === '' ? null : ($orders[$orderId] ?? null);

            if ($order !== null && ! in_array($order->status, OrderStatus::open(), true)) {
                Messages::fail('order', 'order_not_open');
            }

            $map = $this->receipts->receiveForInvoice($invoice, $group, $order, $actor);

            foreach ($group as $line) {
                $line->receipt_line_id = $map[$line->id];
                $line->save();
            }
        }
    }

    /**
     * @param  Collection<int, PurchaseInvoiceLine>  $lines
     * @param  array<string, PurchaseOrder>  $orders
     */
    private function applyToOrders(Collection $lines, array $orders, int $sign, ?Authenticatable $actor): void
    {
        $touched = [];
        $orderOfLine = $this->orderIdsOfLines($lines);

        foreach ($lines as $line) {
            $orderId = $orderOfLine[$line->id] ?? null;

            if ($line->order_line_id === null || $orderId === null || ! isset($orders[$orderId])) {
                continue;
            }

            $orderLine = PurchaseOrderLine::query()->whereKey($line->order_line_id)->firstOrFail();
            $this->progress->addInvoiced($orderLine, $sign > 0 ? $line->quantity : $line->quantity->negated());
            $touched[$orderId] = $orders[$orderId];
        }

        foreach ($touched as $order) {
            $this->progress->refresh($order, $actor);
        }
    }

    /**
     * Debit notes never give back more than the original line: amounts already debited (debit
     * notes not reversed) are deducted, the debit that completes a line's quantity takes exactly
     * what remains, and partial debits are capped by it. Header totals follow the lines.
     *
     * @param  list<array<string, mixed>>  $extras
     * @param  array<string, PurchaseInvoiceLine>  $originals
     */
    private function allocateDebit(Composed $composed, array $extras, array $originals, string $fxRate): Composed
    {
        $lines = $composed->lines;
        // What earlier lines of this same debit note already took of each original line.
        $taken = [];

        foreach ($lines as $i => $row) {
            $source = $originals[(string) ($extras[$i]['original_line_id'] ?? '')] ?? null;

            if ($source === null) {
                continue;
            }

            $prev = DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
                ->where('l.original_line_id', $source->id)->whereIn('i.status', InvoiceStatus::booked())
                ->selectRaw('coalesce(sum(l.quantity), 0) AS qty, coalesce(sum(l.line_discount), 0) AS discount, coalesce(sum(l.net_amount), 0) AS net,
                    coalesce(sum(l.tax_amount), 0) AS tax, coalesce(sum(l.withholding_amount), 0) AS withholding')
                ->first();
            $here = $taken[$source->id] ?? ['qty' => BigDecimal::zero(), 'discount' => BigDecimal::zero(), 'net' => BigDecimal::zero(), 'tax' => BigDecimal::zero(), 'withholding' => BigDecimal::zero()];
            $left = [
                'discount' => $source->line_discount->minus((string) ($prev->discount ?? '0'))->minus($here['discount']),
                'net' => $source->net_amount->minus((string) ($prev->net ?? '0'))->minus($here['net']),
                'tax' => $source->tax_amount->minus((string) ($prev->tax ?? '0'))->minus($here['tax']),
                'withholding' => $source->withholding_amount->minus((string) ($prev->withholding ?? '0'))->minus($here['withholding']),
            ];
            $final = Purchasing::dec((string) ($prev->qty ?? '0'))->plus($here['qty'])->plus((string) $row['quantity'])->isGreaterThanOrEqualTo($source->quantity);
            $amounts = [];

            foreach (['discount' => 'line_discount', 'net' => 'net_amount', 'tax' => 'tax_amount', 'withholding' => 'withholding_amount'] as $key => $column) {
                $value = Purchasing::dec((string) $row[$column]);
                $amounts[$key] = $final || $value->isGreaterThan($left[$key]) ? $left[$key] : $value;
                $amounts[$key] = $amounts[$key]->isNegative() ? BigDecimal::zero() : $amounts[$key];
            }

            if ($amounts['withholding']->isGreaterThan($amounts['tax'])) {
                $amounts['withholding'] = $amounts['tax'];
            }

            $taken[$source->id] = [
                'qty' => $here['qty']->plus((string) $row['quantity']), 'discount' => $here['discount']->plus($amounts['discount']),
                'net' => $here['net']->plus($amounts['net']), 'tax' => $here['tax']->plus($amounts['tax']),
                'withholding' => $here['withholding']->plus($amounts['withholding']),
            ];

            $lines[$i] = [...$row,
                'line_discount' => Purchasing::money($amounts['discount']),
                'net_amount' => Purchasing::money($amounts['net']),
                'tax_amount' => Purchasing::money($amounts['tax']),
                'withholding_amount' => Purchasing::money($amounts['withholding']),
                'gross_amount' => Purchasing::money($amounts['net']->plus($amounts['discount'])),
                'line_total' => Purchasing::money($amounts['net']->plus($amounts['tax'])),
            ];
        }

        return new Composed([...$composed->header, ...self::retotal($lines, $fxRate)], $lines, $composed->totals, $composed->warnings, $composed->priceOverrides);
    }

    /**
     * Header totals of given lines with the rules of TotalsEngine (tax per tax code converted, net
     * locally as the difference).
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, string>
     */
    private static function retotal(array $lines, string $fxRate): array
    {
        $sum = [
            'gross_amount' => BigDecimal::zero(), 'line_discount' => BigDecimal::zero(), 'tax_amount' => BigDecimal::zero(),
            'line_total' => BigDecimal::zero(), 'withholding_amount' => BigDecimal::zero(),
        ];
        $taxes = [];

        foreach ($lines as $line) {
            foreach (array_keys($sum) as $column) {
                $sum[$column] = $sum[$column]->plus((string) $line[$column]);
            }

            $key = ($line['tax_code_id'] ?? '').'|'.(string) $line['tax_rate'];
            $taxes[$key] = ($taxes[$key] ?? BigDecimal::zero())->plus((string) $line['tax_amount']);
        }

        $taxLocal = BigDecimal::zero();

        foreach ($taxes as $tax) {
            $taxLocal = $taxLocal->plus(RoundingPolicy::currency($tax->multipliedBy($fxRate)));
        }

        $totalLocal = RoundingPolicy::currency($sum['line_total']->multipliedBy($fxRate));
        $discountLocal = RoundingPolicy::currency($sum['line_discount']->multipliedBy($fxRate));
        $withholdingLocal = Purchasing::min(RoundingPolicy::currency($sum['withholding_amount']->multipliedBy($fxRate)), $taxLocal);

        return [
            'subtotal' => Purchasing::money($sum['gross_amount']), 'discount_total' => Purchasing::money($sum['line_discount']),
            'tax_total' => Purchasing::money($sum['tax_amount']), 'total' => Purchasing::money($sum['line_total']),
            'withholding_total' => Purchasing::money($sum['withholding_amount']),
            'subtotal_local' => Purchasing::money($totalLocal->minus($taxLocal)->plus($discountLocal)), 'discount_total_local' => Purchasing::money($discountLocal),
            'tax_total_local' => Purchasing::money($taxLocal), 'total_local' => Purchasing::money($totalLocal),
            'withholding_total_local' => Purchasing::money($withholdingLocal),
        ];
    }

    /** Receipt and order bounds again at booking, under the same locks. */
    private function recheckBounds(PurchaseInvoice $invoice): void
    {
        $this->sourceLines($this->linesAsInput($invoice), $invoice->receive_on_invoice, $invoice->id, $invoice->party_id, recheck: true);
    }

    /** Cancels the receipts this invoice posted itself (receive_on_invoice). */
    private function reverseReceipts(PurchaseInvoice $invoice, string $date, string $reason, ?Authenticatable $actor): bool
    {
        $receipts = PurchaseReceipt::query()->where('invoice_id', $invoice->id)->where('status', ReceiptStatus::Posted->value)->orderBy('id')->get();

        foreach ($receipts as $receipt) {
            foreach ($receipt->lines()->get() as $line) {
                if ($this->quantities->invoicedOnReceipt($line->id, $invoice->id)->isPositive()) {
                    Messages::fail('reverse_stock', 'receipt_invoiced_elsewhere', ['receipt' => (string) $receipt->number]);
                }
            }

            $this->receipts->cancel($receipt, null, $reason, $date, $actor, fromInvoice: true);
        }

        return $receipts->isNotEmpty();
    }

    /**
     * Turns invoice line input into composer input plus source columns, enforcing the bounds.
     * Receipt lines are bounded by what is still open on them; goods invoiced against an order line
     * (receive_on_invoice) by the ordered quantity plus the over-receipt tolerance; services against
     * an order line are left to the three-way match.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>, 2: array<int, string>}
     */
    private function sourceLines(array $lines, bool $receive, ?string $exceptInvoiceId, string $partyId, bool $recheck = false): array
    {
        $inputs = [];
        $extras = [];
        $currencies = [];
        $perReceipt = [];
        $perOrder = [];

        foreach ($lines as $i => $line) {
            $field = "lines.{$i}";
            $qty = Purchasing::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
            $receiptLineId = is_string($line['receipt_line_id'] ?? null) ? $line['receipt_line_id'] : null;
            $orderLineId = is_string($line['order_line_id'] ?? null) ? $line['order_line_id'] : null;

            if ($receiptLineId !== null) {
                $source = PurchaseReceiptLine::query()->whereKey($receiptLineId)->first();
                $receipt = $source === null ? null : PurchaseReceipt::query()->whereKey($source->document_id)->first();

                if ($source === null || $receipt === null || $receipt->party_id !== $partyId) {
                    Messages::fail("{$field}.receipt_line_id", 'source_line_unknown');
                }

                if ($receipt->status !== ReceiptStatus::Posted) {
                    Messages::fail("{$field}.receipt_line_id", 'receipt_not_posted');
                }

                $perReceipt[$source->id] = ($perReceipt[$source->id] ?? BigDecimal::zero())->plus($qty);
                $open = $this->quantities->openOnReceipt($source->id, $source->quantity, $exceptInvoiceId);

                if ($perReceipt[$source->id]->isGreaterThan($open)) {
                    Messages::fail("{$field}.quantity", 'invoice_exceeds_received', ['remaining' => Purchasing::qty($open->isNegative() ? '0' : $open)]);
                }

                $inputs[] = $this->sourcedLine($source, (string) $qty, $line);
                $extras[] = ['receipt_line_id' => $source->id, 'order_line_id' => $source->order_line_id];
                $currencies[$i] = $receipt->currency_code;

                continue;
            }

            if ($orderLineId !== null) {
                $source = PurchaseOrderLine::query()->whereKey($orderLineId)->first();
                $order = $source === null ? null : PurchaseOrder::query()->whereKey($source->document_id)->first();

                if ($source === null || $order === null || $order->party_id !== $partyId) {
                    Messages::fail("{$field}.order_line_id", 'source_line_unknown');
                }

                if (! $recheck && ! in_array($order->status, OrderStatus::open(), true)) {
                    Messages::fail("{$field}.order_line_id", 'order_not_open');
                }

                if ($source->isStock() && ! $receive) {
                    Messages::fail("{$field}.order_line_id", 'invoice_requires_receipt');
                }

                if ($source->isStock() && ! $recheck) {
                    // Goods received at booking add to what receipts already hold of the order line.
                    $perOrder[$source->id] = ($perOrder[$source->id] ?? BigDecimal::zero())->plus($qty);
                    $this->receipts->assertWithinOrder($source, $perOrder[$source->id], null, "{$field}.quantity");
                }

                $currencies[$i] = $order->currency_code;
                $inputs[] = $this->sourcedLine($source, (string) $qty, $line);
                $extras[] = ['receipt_line_id' => null, 'order_line_id' => $source->id];

                continue;
            }

            $inputs[] = array_diff_key($line, ['receipt_line_id' => 1, 'order_line_id' => 1]);
            $extras[] = ['receipt_line_id' => null, 'order_line_id' => null];
        }

        return [$inputs, $extras, $currencies];
    }

    /**
     * Source documents keep their prices in their own currency: an invoice of them must use it.
     *
     * @param  array<int, string>  $currencies  line index => source currency
     */
    private function assertCurrencies(array $currencies, string $currency): void
    {
        foreach ($currencies as $i => $source) {
            if ($source !== $currency) {
                Messages::fail('currency_code', 'source_currency_mismatch', ['currency' => $source, 'line' => $i + 1]);
            }
        }
    }

    /**
     * Locks the sources (orders, then receipts, by id) the stored lines name, with $extra lines
     * (an update's new lines), then the original invoice (for a debit note), then the invoice.
     * Never locks a source while holding the invoice: if the lines name other sources once the
     * invoice is locked, it throws SourcesChanged and withSources() retries the whole transaction.
     * Also used by returns, which must lock receipts before their (booked) source invoice.
     *
     * @param  list<array<string, mixed>>  $extra
     * @return array{0: PurchaseInvoice, 1: array<string, PurchaseOrder>}
     */
    public function lockWithSources(PurchaseInvoice $invoice, array $extra = []): array
    {
        $original = $invoice->original_invoice_id === null ? null : PurchaseInvoice::query()->whereKey($invoice->original_invoice_id)->first();
        $read = $this->withOriginalLines($original, $this->linesAsInput($invoice), $extra);
        $orders = $this->lockSources($read);

        if ($original !== null) {
            $this->lock($original);
        }

        $locked = $this->lock($invoice);
        [$readOrders, $readReceipts] = $this->sourceIds($read);
        [$nowOrders, $nowReceipts] = $this->sourceIds($this->withOriginalLines($original, $this->linesAsInput($locked), $extra));

        if (array_diff($nowOrders, $readOrders) !== [] || array_diff($nowReceipts, $readReceipts) !== []) {
            throw new SourcesChanged($locked->version);
        }

        return [$locked, $orders];
    }

    /**
     * The lines whose sources an invoice lock covers: the original invoice's (debit note), its own, extra.
     *
     * @param  list<array<string, mixed>>  $own
     * @param  list<array<string, mixed>>  $extra
     * @return list<array<string, mixed>>
     */
    private function withOriginalLines(?PurchaseInvoice $original, array $own, array $extra): array
    {
        return [...($original === null ? [] : $this->linesAsInput($original)), ...$own, ...$extra];
    }

    /** A pending invoice of an approval callback, locked after its sources (null when gone). */
    private function lockPending(string $invoiceId): ?PurchaseInvoice
    {
        $invoice = PurchaseInvoice::query()->whereKey($invoiceId)->first();

        return $invoice === null ? null : $this->lockWithSources($invoice)[0];
    }

    /**
     * A transaction that locks an invoice with its sources, retried when the sources changed under
     * it; after the last attempt a controlled VERSION_CONFLICT.
     *
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public function withSources(Closure $fn): mixed
    {
        for ($attempt = 1; ; $attempt++) {
            try {
                return Purchasing::transaction($fn);
            } catch (SourcesChanged $e) {
                if ($attempt >= self::SOURCE_ATTEMPTS) {
                    throw new VersionConflictException($e->version, $e->version);
                }
            }
        }
    }

    /**
     * Splits an order line over its posted receipt lines that are still open (oldest first); with
     * receive_on_invoice the unreceived rest is invoiced against the order line itself. Service
     * lines are invoiced against the order line.
     *
     * @return list<array<string, mixed>>
     */
    private function allocateOrderLine(PurchaseOrderLine $line, ?string $quantity, bool $receive, string $field): array
    {
        if (! $line->isStock()) {
            $open = $line->quantity->minus($this->quantities->invoicedOnOrder($line->id));
            $qty = $quantity === null ? $open : Purchasing::dec($quantity);

            return $qty->isPositive() ? [['order_line_id' => $line->id, 'quantity' => (string) $qty]] : [];
        }

        $want = $quantity === null ? null : Purchasing::dec($quantity);
        $out = [];
        $rows = DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
            ->where('l.order_line_id', $line->id)->where('r.status', ReceiptStatus::Posted->value)
            ->orderBy('r.posted_at')->orderBy('l.line_no')->get(['l.id', 'l.quantity']);

        foreach ($rows as $row) {
            if ($want !== null && ! $want->isPositive()) {
                break;
            }

            $free = $this->quantities->openOnReceipt((string) $row->id, Purchasing::dec((string) $row->quantity));

            if (! $free->isPositive()) {
                continue;
            }

            $take = $want === null ? $free : Purchasing::min($want, $free);
            $out[] = ['receipt_line_id' => (string) $row->id, 'quantity' => (string) $take];
            $want = $want?->minus($take);
        }

        $rest = $want ?? ($receive ? $line->quantity->minus($this->quantities->receivedOrHeld($line->id)) : BigDecimal::zero());

        if ($rest->isPositive()) {
            if (! $receive) {
                Messages::fail($field, 'invoice_exceeds_received', ['remaining' => Purchasing::qty(BigDecimal::zero())]);
            }

            $out[] = ['order_line_id' => $line->id, 'quantity' => (string) $rest];
        }

        return $out;
    }

    /**
     * Locks the orders and receipts referenced by the lines (sorted, orders first).
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, PurchaseOrder>
     */
    private function lockSources(array $lines): array
    {
        [$orderIds, $receiptIds] = $this->sourceIds($lines);
        $orders = $this->lockOrders($orderIds);

        foreach ($receiptIds as $id) {
            PurchaseReceipt::query()->whereKey($id)->lockForUpdate()->first();
        }

        return $orders;
    }

    /**
     * Ids of the orders and receipts the lines reference, each list unique and sorted.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<string>, 1: list<string>}
     */
    private function sourceIds(array $lines): array
    {
        $receiptLineIds = array_values(array_filter(array_map(static fn (array $l): ?string => is_string($l['receipt_line_id'] ?? null) ? $l['receipt_line_id'] : null, $lines)));
        $orderLineIds = array_values(array_filter(array_map(static fn (array $l): ?string => is_string($l['order_line_id'] ?? null) ? $l['order_line_id'] : null, $lines)));
        $receiptIds = $receiptLineIds === [] ? [] : PurchaseReceiptLine::query()->whereIn('id', $receiptLineIds)->distinct()->pluck('document_id')->all();
        $orderIds = $orderLineIds === [] ? [] : PurchaseOrderLine::query()->whereIn('id', $orderLineIds)->distinct()->pluck('document_id')->all();
        $orderIds = array_merge($orderIds, $receiptIds === [] ? [] : PurchaseReceipt::query()->whereIn('id', $receiptIds)->whereNotNull('order_id')->pluck('order_id')->all());
        $orderIds = array_values(array_unique(array_map('strval', $orderIds)));
        $receiptIds = array_values(array_unique(array_map('strval', $receiptIds)));
        sort($orderIds);
        sort($receiptIds);

        return [$orderIds, $receiptIds];
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, PurchaseOrder>
     */
    private function lockOrders(array $ids): array
    {
        sort($ids);
        $orders = [];

        foreach ($ids as $id) {
            $orders[$id] = PurchaseOrder::query()->whereKey($id)->lockForUpdate()->firstOrFail();
        }

        return $orders;
    }

    /**
     * @param  Collection<int, PurchaseInvoiceLine>  $lines
     * @return array<string, string> invoice line id => order id
     */
    private function orderIdsOfLines(Collection $lines): array
    {
        $orderLineIds = $lines->pluck('order_line_id')->filter()->values()->all();
        $orderOf = $orderLineIds === [] ? [] : PurchaseOrderLine::query()->whereIn('id', $orderLineIds)->pluck('document_id', 'id')->all();
        $map = [];

        foreach ($lines as $line) {
            if ($line->order_line_id !== null && isset($orderOf[$line->order_line_id])) {
                $map[$line->id] = (string) $orderOf[$line->order_line_id];
            }
        }

        return $map;
    }

    /**
     * The stored lines as invoice input (sources and prices kept).
     *
     * @return list<array<string, mixed>>
     */
    private function linesAsInput(PurchaseInvoice $invoice): array
    {
        $out = [];

        foreach ($invoice->lines()->get() as $line) {
            $input = $this->keptLine($line, (string) $line->quantity);

            if ($line->receipt_line_id !== null) {
                $input = ['receipt_line_id' => $line->receipt_line_id, 'quantity' => (string) $line->quantity, 'unit_price' => (string) $line->unit_price];
            } elseif ($line->order_line_id !== null) {
                $input = ['order_line_id' => $line->order_line_id, 'quantity' => (string) $line->quantity, 'unit_price' => (string) $line->unit_price];
            }

            $out[] = $input;
        }

        return $out;
    }

    /**
     * @param  list<array<string, mixed>>  $lines  composed lines
     * @param  list<array<string, mixed>>  $extras
     */
    private function assertReceivable(array $lines, array $extras, bool $receive): void
    {
        foreach ($lines as $i => $line) {
            if (($line['item_type'] ?? null) === 'stock' && ($extras[$i]['receipt_line_id'] ?? null) === null && ! $receive) {
                Messages::fail("lines.{$i}.item_id", 'invoice_requires_receipt');
            }
        }
    }

    /**
     * @param  list<array<string, mixed>>  $extras
     * @return array<string, mixed>
     */
    private function headerExtras(array $extras): array
    {
        $orderLineIds = array_values(array_filter(array_column($extras, 'order_line_id')));
        $orderIds = $orderLineIds === [] ? [] : PurchaseOrderLine::query()->whereIn('id', $orderLineIds)->distinct()->pluck('document_id')->all();

        return ['order_id' => count($orderIds) === 1 ? (string) $orderIds[0] : null];
    }

    /**
     * Header of a converted invoice: the source's supplier and currency, a new date (and rate, due date).
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function convertedHeader(PurchaseOrder|PurchaseReceipt $source, array $data): array
    {
        $header = $this->mergedHeader($source, array_intersect_key($data, array_flip(['notes', 'internal_notes', 'due_date', 'fx_rate'])));
        $header['document_date'] = $data['document_date'] ?? now()->toDateString();

        if (! array_key_exists('due_date', $data)) {
            unset($header['due_date']);
        }

        if (! array_key_exists('fx_rate', $data)) {
            unset($header['fx_rate']);
        }

        return $header;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function supplierNumber(array $data): ?string
    {
        $number = $data['supplier_invoice_no'] ?? null;

        return is_string($number) && trim($number) !== '' ? trim($number) : null;
    }

    /**
     * A supplier invoice number is used once per supplier among invoices that are not cancelled or
     * reversed; checks of one supplier serialize on an advisory lock (the unique index is the backstop).
     */
    private function assertSupplierNumber(mixed $partyId, ?string $number, ?string $exceptId): void
    {
        if ($number === null || ! is_string($partyId)) {
            return;
        }

        Purchasing::lock(app(CompanyContext::class)->id(), 'supplier_no.'.$partyId);
        $taken = PurchaseInvoice::query()->where('party_id', $partyId)->where('invoice_type', InvoiceType::Purchase->value)
            ->where('supplier_invoice_no', $number)->whereNotIn('status', [InvoiceStatus::Cancelled->value, InvoiceStatus::Reversed->value])
            ->when($exceptId !== null, fn ($q) => $q->where('id', '<>', $exceptId))->exists();

        if ($taken) {
            Messages::fail('supplier_invoice_no', 'supplier_invoice_duplicate', ['number' => $number]);
        }
    }

    private function notifyCreator(PurchaseInvoice $invoice, string $key): void
    {
        if ($invoice->created_by === null) {
            return;
        }

        try {
            $this->notifier->notify($invoice->created_by, 'purchasing.'.$key, [
                'title' => Messages::get($key.'_title', ['number' => (string) ($invoice->number ?? $invoice->supplier_invoice_no)]),
                'body' => Messages::get($key.'_body', ['number' => (string) ($invoice->number ?? $invoice->supplier_invoice_no)]),
                'url' => '/purchasing/invoices/'.$invoice->id,
                'invoice_id' => $invoice->id,
            ]);
        } catch (\Throwable $e) {
            Log::warning('purchasing approval notification failed', ['invoice' => $invoice->id, 'error' => $e->getMessage()]);
        }
    }
}
