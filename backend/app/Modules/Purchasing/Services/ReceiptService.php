<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Data\StockPosted;
use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Data\StockPostingRequest;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use App\Modules\Purchasing\Events\PurchaseReceiptPosted;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseInvoiceLine;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseReceiptLine;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Services\Machines\ReceiptMachine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Goods receipts: from an order (bounded by the ordered quantity plus the over-receipt tolerance,
 * under the order row lock) or direct when the company allows it. Posting receives the stock
 * through StockService in the same transaction at the line's net price converted to company
 * currency per base unit, with offset purchase.goods_received (Dr stock / Cr goods received not
 * invoiced), and updates the order. All lines of a receipt go into its header warehouse.
 */
final class ReceiptService extends DocumentService
{
    public const string SOURCE_TYPE = 'purchase_receipt';

    public const string GRNI_EVENT = 'purchase.goods_received';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly ReceiptMachine $machine,
        private readonly StockService $stock,
        private readonly OrderProgress $progress,
        private readonly Quantities $quantities,
        private readonly PurchasingSettings $settings,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data  document_date, warehouse_id, supplier_reference, fx_rate, notes
     * @param  list<array<string, mixed>>|null  $lines  order_line_id, quantity, lot_no, expiry_date, serial_numbers, location_id; null = everything remaining
     */
    public function createFromOrder(PurchaseOrder $order, array $data, ?array $lines, ?Authenticatable $actor): PurchaseReceipt
    {
        return Purchasing::transaction(function () use ($order, $data, $lines, $actor): PurchaseReceipt {
            $order = $this->lockOrder($order->id);
            $this->assertOrderOpen($order);
            $orderLines = $order->lines()->get()->keyBy('id');

            if ($lines === null) {
                $lines = [];

                foreach ($orderLines as $line) {
                    $remaining = $line->quantity->minus($this->quantities->receivedOrHeld($line->id));

                    if ($line->isStock() && $remaining->isPositive()) {
                        $lines[] = ['order_line_id' => $line->id, 'quantity' => (string) $remaining];
                    }
                }

                if ($lines === []) {
                    Messages::fail('lines', 'nothing_to_receive');
                }
            }

            [$inputs, $extras] = $this->orderLines($orderLines->all(), $lines, null);
            $header = $this->mergedHeader($order, array_intersect_key($data, array_flip(['warehouse_id', 'notes', 'fx_rate'])));
            $header['document_date'] = $data['document_date'] ?? now()->toDateString();
            unset($header['due_date']);
            $composed = $this->compose($header, $inputs, true, requireWarehouse: true);

            return $this->store->create(new PurchaseReceipt, $composed, [
                'order_id' => $order->id, 'source_type' => 'purchase_order', 'source_id' => $order->id,
                'supplier_reference' => DocumentComposer::str($data['supplier_reference'] ?? null),
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * A receipt without an order (company setting purchasing.allow_direct_receipt).
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    public function createDirect(array $data, array $lines, ?Authenticatable $actor, bool $canOverridePrice): PurchaseReceipt
    {
        if (! $this->settings->allowDirectReceipt()) {
            Messages::fail('order_id', 'direct_receipt_disabled');
        }

        return Purchasing::transaction(function () use ($data, $lines, $actor, $canOverridePrice): PurchaseReceipt {
            [$inputs, $extras] = $this->directLines($lines);
            $composed = $this->compose($data, $inputs, $canOverridePrice, requireWarehouse: true);
            $this->assertStockLines($composed->lines);

            return $this->store->create(new PurchaseReceipt, $composed, [
                'supplier_reference' => DocumentComposer::str($data['supplier_reference'] ?? null),
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(PurchaseReceipt $receipt, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): PurchaseReceipt
    {
        return Purchasing::transaction(function () use ($receipt, $data, $lines, $version, $canOverridePrice): PurchaseReceipt {
            $order = $receipt->order_id === null ? null : $this->lockOrder($receipt->order_id);
            $receipt = $this->lock($receipt);
            $this->assertDraft($receipt);
            $receipt->assertVersion($version);

            if ($receipt->invoice_id !== null) {
                Messages::fail('document', 'receipt_belongs_to_invoice');
            }

            $header = $this->mergedHeader($receipt, array_diff_key($data, $order === null ? [] : ['party_id' => true, 'currency_code' => true]));
            $extra = array_key_exists('supplier_reference', $data) ? ['supplier_reference' => DocumentComposer::str($data['supplier_reference'])] : [];

            if ($order !== null) {
                $this->assertOrderOpen($order);
                $lines ??= array_values($receipt->lines()->get()->map(static fn (PurchaseReceiptLine $l): array => [
                    'order_line_id' => $l->order_line_id, 'quantity' => (string) $l->quantity, 'lot_no' => $l->lot_no,
                    'expiry_date' => $l->expiry_date?->format('Y-m-d'), 'serial_numbers' => $l->serial_numbers, 'location_id' => $l->location_id,
                ])->all());
                [$inputs, $extras] = $this->orderLines($order->lines()->get()->keyBy('id')->all(), $lines, $receipt->id);
                $composed = $this->compose($header, $inputs, true, requireWarehouse: true);
            } else {
                if ($lines === null) {
                    $stored = $receipt->lines()->get();
                    [$inputs] = $this->editedLines($stored, null);
                    $extras = array_values($stored->map(static fn (PurchaseReceiptLine $l): array => [
                        'lot_no' => $l->lot_no, 'expiry_date' => $l->expiry_date?->format('Y-m-d'), 'serial_numbers' => $l->serial_numbers,
                        'location_id' => $l->location_id,
                    ])->all());
                } else {
                    [$inputs, $extras] = $this->directLines($lines);
                }

                $composed = $this->compose($header, $inputs, $canOverridePrice, requireWarehouse: true);
                $this->assertStockLines($composed->lines);
            }

            return $this->store->replace($receipt, $composed, $extra, $extras);
        });
    }

    public function delete(PurchaseReceipt $receipt, ?int $version): void
    {
        Purchasing::transaction(function () use ($receipt, $version): void {
            $receipt = $this->lock($receipt);
            $this->assertDraft($receipt);

            if ($version !== null) {
                $receipt->assertVersion($version);
            }

            if ($receipt->invoice_id !== null) {
                Messages::fail('document', 'receipt_belongs_to_invoice');
            }

            $receipt->delete();
        });
    }

    /**
     * Posts the receipt once: a posted receipt is returned unchanged (idempotent by state).
     *
     * @return array{0: PurchaseReceipt, 1: bool} the receipt and whether it had been posted before
     */
    public function post(PurchaseReceipt $receipt, ?int $version, ?Authenticatable $actor): array
    {
        return Purchasing::transaction(function () use ($receipt, $version, $actor): array {
            $order = $receipt->order_id === null ? null : $this->lockOrder($receipt->order_id);
            $receipt = $this->lock($receipt);

            if ($receipt->status === ReceiptStatus::Posted) {
                return [$receipt, true];
            }

            if ($version !== null) {
                $receipt->assertVersion($version);
            }

            $this->assertStatus($receipt, [ReceiptStatus::Draft], ReceiptStatus::Posted->value);

            return [$this->postLocked($receipt, $order, $actor), false];
        });
    }

    /**
     * Cancels a draft, or reverses a posted receipt that nothing has invoiced or returned (stock
     * and its journal back through StockService::reverse on $date, order quantities reduced). The
     * actor is authorized against the locked receipt: update for a draft, reverse for a posted one.
     */
    public function cancel(PurchaseReceipt $receipt, ?int $version, ?string $reason, ?string $date, ?Authenticatable $actor, bool $fromInvoice = false): PurchaseReceipt
    {
        return Purchasing::transaction(function () use ($receipt, $version, $reason, $date, $actor, $fromInvoice): PurchaseReceipt {
            $order = $receipt->order_id === null ? null : $this->lockOrder($receipt->order_id);
            $receipt = $this->lock($receipt, $version);

            if ($receipt->status === ReceiptStatus::Cancelled) {
                return $receipt;
            }

            if ($receipt->invoice_id !== null && ! $fromInvoice) {
                Messages::fail('document', 'receipt_belongs_to_invoice');
            }

            if (! $fromInvoice && $actor !== null) {
                Gate::forUser($actor)->authorize($receipt->status === ReceiptStatus::Posted ? 'reverse' : 'update', $receipt);
            }

            $receipt->cancelled_at = now();
            $receipt->cancelled_by = self::actorId($actor);
            $receipt->cancel_reason = $reason;

            if ($receipt->status === ReceiptStatus::Draft) {
                return $this->machine->transition($receipt, ReceiptStatus::Cancelled, $actor);
            }

            $reason = trim((string) $reason);

            if ($reason === '') {
                Messages::fail('reason', 'reason_required');
            }

            $lines = $receipt->lines()->get();

            foreach ($lines as $line) {
                if (! $fromInvoice && $this->quantities->invoicedOnReceipt($line->id)->isPositive()) {
                    Messages::fail('document', 'receipt_invoiced');
                }

                if (DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
                    ->where('l.receipt_line_id', $line->id)->where('r.status', '<>', 'cancelled')->exists()) {
                    Messages::fail('document', 'receipt_returned');
                }
            }

            $reversalDate = $date ?? now()->toDateString();

            if ($reversalDate < $receipt->document_date->format('Y-m-d')) {
                Messages::fail('date', 'reverse_before_document');
            }

            $reversed = $this->stock->reverse((string) $receipt->stock_document_id, new DateTimeImmutable($reversalDate), $reason);
            $receipt->reversal_stock_document_id = $reversed->documentId;
            $receipt->reversal_date = Carbon::parse($reversalDate);

            if ($order !== null) {
                $orderLines = $order->lines()->get()->keyBy('id');

                foreach ($lines as $line) {
                    $orderLine = $line->order_line_id === null ? null : $orderLines->get($line->order_line_id);

                    if ($orderLine instanceof PurchaseOrderLine) {
                        $this->progress->addReceived($orderLine, $line->quantity->negated());
                    }
                }

                $this->progress->refresh($order, $actor);
            }

            return $this->machine->transition($receipt, ReceiptStatus::Cancelled, $actor);
        });
    }

    /**
     * Creates and posts the receipt of an invoice's stock lines (receive_on_invoice), inside the
     * booking transaction, at the invoice line's net price; returns invoice line id => receipt line id.
     *
     * @param  list<PurchaseInvoiceLine>  $lines
     * @return array<string, string>
     */
    public function receiveForInvoice(PurchaseInvoice $invoice, array $lines, ?PurchaseOrder $order, ?Authenticatable $actor): array
    {
        $inputs = [];
        $extras = [];
        $orderLines = $order?->lines()->get()->keyBy('id');
        $requested = [];

        foreach ($lines as $i => $line) {
            $orderLine = $line->order_line_id === null ? null : $orderLines?->get($line->order_line_id);

            if ($orderLine instanceof PurchaseOrderLine) {
                $requested[$orderLine->id] = ($requested[$orderLine->id] ?? BigDecimal::zero())->plus($line->quantity);
                $this->assertWithinOrder($orderLine, $requested[$orderLine->id], null, "lines.{$i}.quantity");
            }

            // Goods of an order are received at the order's net price (like any receipt of it), so the
            // invoice books the difference as price variance; goods without an order at the invoice price.
            $source = $orderLine instanceof PurchaseOrderLine ? $orderLine : $line;
            $inputs[] = [...$this->fixedLine($source, (string) $line->quantity, true), 'source_line_id' => $line->id,
                '_base_quantity' => (string) $line->base_quantity, 'warehouse_id' => $line->warehouse_id];
            $extras[] = ['order_line_id' => $orderLine?->id];
        }

        $header = $this->mergedHeader($invoice, []);

        if ($order !== null) {
            $header['fx_rate'] = (string) $order->fx_rate;
        }
        $composed = $this->compose($header, $inputs, true, requireWarehouse: true);
        $receipt = $this->store->create(new PurchaseReceipt, $composed, [
            'order_id' => $order?->id, 'invoice_id' => $invoice->id, 'source_type' => 'purchase_invoice', 'source_id' => $invoice->id,
            'supplier_reference' => $invoice->supplier_invoice_no,
        ], $extras, self::actorId($actor));
        $this->postLocked($this->lock($receipt), $order, $actor);
        $map = [];

        foreach ($receipt->lines()->get() as $i => $receiptLine) {
            $map[$lines[$i]->id] = $receiptLine->id;
        }

        return $map;
    }

    /** Net price of a line in company currency per base unit (scale 6). */
    public static function unitCost(PurchaseReceiptLine $line, BigDecimal $fxRate): string
    {
        if (! $line->base_quantity->isPositive()) {
            return '0.000000';
        }

        return (string) $line->net_amount->multipliedBy($fxRate)->dividedBy($line->base_quantity, 6, RoundingMode::HalfUp);
    }

    private function postLocked(PurchaseReceipt $receipt, ?PurchaseOrder $order, ?Authenticatable $actor): PurchaseReceipt
    {
        $lines = $receipt->lines()->get();
        $orderLines = $order?->lines()->get()->keyBy('id');

        if ($lines->isEmpty()) {
            Messages::fail('lines', 'lines_required');
        }

        $warehouseId = $receipt->warehouse_id ?? Messages::fail('warehouse_id', 'warehouse_required');

        if ($order !== null && $receipt->invoice_id === null) {
            $this->assertOrderOpen($order);
        }

        $stockLines = [];
        $requested = [];

        foreach ($lines as $i => $line) {
            if (! $line->isStock()) {
                Messages::fail("lines.{$i}.item_id", 'line_not_receivable');
            }

            $orderLine = $line->order_line_id === null ? null : $orderLines?->get($line->order_line_id);

            if ($orderLine instanceof PurchaseOrderLine) {
                // Several lines of one order line count together.
                $requested[$orderLine->id] = ($requested[$orderLine->id] ?? BigDecimal::zero())->plus($line->quantity);
                $this->assertWithinOrder($orderLine, $requested[$orderLine->id], $receipt->id, "lines.{$i}.quantity");
            }

            $stockLines[] = new StockPostingLine(
                itemId: $line->item_id,
                quantity: (string) $line->base_quantity,
                unitCost: self::unitCost($line, $receipt->fx_rate),
                lotNo: $line->lot_no,
                expiry: $line->expiry_date?->format('Y-m-d'),
                serials: $line->serial_numbers,
                locationId: $line->location_id,
            );
        }

        $this->store->assignNumber($receipt, DocumentKind::Receipt);
        $posted = $this->stock->post(new StockPostingRequest(
            $receipt->company_id, DocumentType::Receipt, null, new DateTimeImmutable($receipt->document_date->format('Y-m-d')),
            $warehouseId, null, $stockLines, self::GRNI_EVENT, self::SOURCE_TYPE, $receipt->id,
            movementType: MovementType::Receipt, reason: (string) $receipt->number, postedBy: self::actorId($actor),
        ));

        $costs = $this->lineCosts($posted);
        $total = BigDecimal::zero()->toScale(4);

        foreach ($lines as $line) {
            $cost = $costs[$line->line_no] ?? ['cost' => '0', 'lots' => null];
            $lineCost = Purchasing::dec($cost['cost'])->toScale(4, RoundingMode::HalfUp);
            $line->setAttribute('cost_total', (string) $lineCost);
            $line->setAttribute('unit_cost', (string) $lineCost->dividedBy($line->base_quantity, 6, RoundingMode::HalfUp));
            $line->save();
            $total = $total->plus($lineCost);
            $orderLine = $line->order_line_id === null ? null : $orderLines?->get($line->order_line_id);

            if ($orderLine instanceof PurchaseOrderLine) {
                $this->progress->addReceived($orderLine, $line->quantity);
            }
        }

        if ($order !== null) {
            $this->progress->refresh($order, $actor);
        }

        $receipt->stock_document_id = $posted->documentId;
        $receipt->journal_entry_id = $posted->journalEntryId;
        $receipt->setAttribute('cost_total', (string) $total);
        $receipt->posted_at = now();
        $receipt->posted_by = self::actorId($actor);
        $this->machine->transition($receipt, ReceiptStatus::Posted, $actor);
        event(new PurchaseReceiptPosted($receipt->company_id, $receipt->id, (string) $receipt->number, $receipt->order_id,
            $posted->documentId, $posted->journalEntryId, (string) $total));

        return $receipt;
    }

    /**
     * @return array<int, array{cost: string, lots: string|null}>
     */
    private function lineCosts(StockPosted $posted): array
    {
        $out = [];

        foreach ($posted->lines as $line) {
            $out[$line->lineNo] = ['cost' => $line->totalCost, 'lots' => $line->lotNos === [] ? null : implode(',', $line->lotNos)];
        }

        return $out;
    }

    /**
     * Order lines picked for a receipt, checked against the remaining quantity.
     *
     * @param  array<string, PurchaseOrderLine>  $orderLines
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function orderLines(array $orderLines, array $lines, ?string $exceptReceiptId): array
    {
        $inputs = [];
        $extras = [];
        $requested = [];

        foreach ($lines as $i => $line) {
            $id = is_string($line['order_line_id'] ?? null) ? $line['order_line_id'] : '';
            $orderLine = $orderLines[$id] ?? null;

            if ($orderLine === null) {
                Messages::fail("lines.{$i}.order_line_id", 'source_line_unknown');
            }

            if (! $orderLine->isStock()) {
                Messages::fail("lines.{$i}.order_line_id", 'line_not_receivable');
            }

            $qty = Purchasing::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
            $requested[$id] = ($requested[$id] ?? BigDecimal::zero())->plus($qty);
            $this->assertWithinOrder($orderLine, $requested[$id], $exceptReceiptId, "lines.{$i}.quantity");
            $inputs[] = [...$this->fixedLine($orderLine, (string) $qty), 'warehouse_id' => null, 'source_line_id' => $orderLine->id];
            $extras[] = ['order_line_id' => $orderLine->id, ...self::tracking($line)];
        }

        return [$inputs, $extras];
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function directLines(array $lines): array
    {
        $extras = array_map(self::tracking(...), $lines);
        $inputs = array_map(static fn (array $l): array => [
            ...array_diff_key($l, ['lot_no' => 1, 'expiry_date' => 1, 'serial_numbers' => 1, 'location_id' => 1, 'order_line_id' => 1]), 'warehouse_id' => null,
        ], $lines);

        return [$inputs, $extras];
    }

    /**
     * @param  array<string, mixed>  $line
     * @return array<string, mixed>
     */
    private static function tracking(array $line): array
    {
        return [
            'lot_no' => DocumentComposer::str($line['lot_no'] ?? null),
            'expiry_date' => DocumentComposer::str($line['expiry_date'] ?? null),
            'serial_numbers' => array_values(array_map('strval', is_array($line['serial_numbers'] ?? null) ? $line['serial_numbers'] : [])),
            'location_id' => DocumentComposer::str($line['location_id'] ?? null),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function assertStockLines(array $lines): void
    {
        foreach ($lines as $i => $line) {
            if (($line['item_type'] ?? null) !== 'stock') {
                Messages::fail("lines.{$i}.item_id", 'line_not_receivable');
            }
        }
    }

    /**
     * Ordered quantity plus the tolerance must cover what receipts (drafts included) hold.
     */
    public function assertWithinOrder(PurchaseOrderLine $line, BigDecimal $qty, ?string $exceptReceiptId, string $field): void
    {
        $allowed = $line->quantity->multipliedBy(BigDecimal::of(100 + $this->settings->overReceiptPercent()))->dividedBy(100, 6, RoundingMode::Down);
        $held = $this->quantities->receivedOrHeld($line->id, $exceptReceiptId);

        if ($held->plus($qty)->isGreaterThan($allowed)) {
            $remaining = $allowed->minus($held);
            Messages::fail($field, 'receipt_exceeds_order', ['remaining' => Purchasing::qty($remaining->isNegative() ? '0' : $remaining)]);
        }
    }

    private function assertOrderOpen(PurchaseOrder $order): void
    {
        if (! in_array($order->status, OrderStatus::open(), true)) {
            Messages::fail('order', 'order_not_open');
        }
    }

    private function lockOrder(string $orderId): PurchaseOrder
    {
        return PurchaseOrder::query()->whereKey($orderId)->lockForUpdate()->firstOrFail();
    }
}
