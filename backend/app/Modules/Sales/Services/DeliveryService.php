<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Data\StockPosted;
use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Data\StockPostingRequest;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Sales\Enums\DeliveryStatus;
use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Events\SalesDeliveryPosted;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesDeliveryLine;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesInvoiceLine;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesOrderLine;
use App\Modules\Sales\Services\Composer\DocumentComposer;
use App\Modules\Sales\Services\Machines\DeliveryMachine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use App\Modules\Sales\Support\SalesSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Deliveries (dispatch notes): from an order (bounded by the remaining quantity plus the
 * over-delivery tolerance, under the order row lock) or direct when the company allows it.
 * Posting issues the stock through StockService in the same transaction (the COGS entry is booked
 * there with offset inventory.cogs), consumes the order reservations and updates the order.
 * All lines of a delivery leave from its header warehouse.
 */
final class DeliveryService extends DocumentService
{
    public const string SOURCE_TYPE = 'sales_delivery';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly DeliveryMachine $machine,
        private readonly StockService $stock,
        private readonly OrderProgress $progress,
        private readonly Quantities $quantities,
        private readonly SalesSettings $settings,
        private readonly OrderReservations $reservations,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data  document_date, warehouse_id, notes
     * @param  list<array<string, mixed>>|null  $lines  order_line_id, quantity, lot_no, serial_numbers; null = everything remaining
     */
    public function createFromOrder(SalesOrder $order, array $data, ?array $lines, ?Authenticatable $actor): SalesDelivery
    {
        return Sales::transaction(function () use ($order, $data, $lines, $actor): SalesDelivery {
            $order = $this->lockOrder($order->id);
            $this->assertOrderOpen($order);
            $orderLines = $order->lines()->get()->keyBy('id');

            if ($lines === null) {
                $lines = [];

                foreach ($orderLines as $line) {
                    $remaining = $line->quantity->minus($this->quantities->deliveredOrHeld($line->id));

                    if ($line->isStock() && $remaining->isPositive()) {
                        $lines[] = ['order_line_id' => $line->id, 'quantity' => (string) $remaining];
                    }
                }

                if ($lines === []) {
                    Messages::fail('lines', 'nothing_to_deliver');
                }
            }

            [$inputs, $extras] = $this->orderLines($orderLines->all(), $lines, null);
            $header = $this->mergedHeader($order, array_intersect_key($data, array_flip(['warehouse_id', 'notes'])));
            $header['document_date'] = $data['document_date'] ?? now()->toDateString();
            unset($header['due_date']);
            $composed = $this->compose($header, $inputs, true, requireWarehouse: true);

            return $this->store->create(new SalesDelivery, $composed, [
                'order_id' => $order->id, 'source_type' => 'sales_order', 'source_id' => $order->id,
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * A delivery without an order (company setting sales.allow_direct_delivery).
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    public function createDirect(array $data, array $lines, ?Authenticatable $actor, bool $canOverridePrice): SalesDelivery
    {
        if (! $this->settings->allowDirectDelivery()) {
            Messages::fail('order_id', 'direct_delivery_disabled');
        }

        return Sales::transaction(function () use ($data, $lines, $actor, $canOverridePrice): SalesDelivery {
            [$inputs, $extras] = $this->directLines($lines);
            $composed = $this->compose($data, $inputs, $canOverridePrice, requireWarehouse: true);
            $this->assertStockLines($composed->lines);
            $delivery = $this->store->create(new SalesDelivery, $composed, [], $extras, self::actorId($actor));
            $this->logOverrides($delivery, $composed, $actor);

            return $delivery;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(SalesDelivery $delivery, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): SalesDelivery
    {
        return Sales::transaction(function () use ($delivery, $data, $lines, $version, $actor, $canOverridePrice): SalesDelivery {
            $order = $delivery->order_id === null ? null : $this->lockOrder($delivery->order_id);
            $delivery = $this->lock($delivery, $version);
            $this->assertDraft($delivery);

            if ($delivery->invoice_id !== null) {
                Messages::fail('document', 'delivery_belongs_to_invoice');
            }

            $header = $this->mergedHeader($delivery, array_diff_key($data, $order === null ? [] : ['party_id' => true, 'currency_code' => true]));

            if ($order !== null) {
                $this->assertOrderOpen($order);
                $lines ??= $delivery->lines->map(fn (SalesDeliveryLine $l): array => [
                    'order_line_id' => $l->order_line_id, 'quantity' => (string) $l->quantity, 'lot_no' => $l->lot_no, 'serial_numbers' => $l->serial_numbers,
                ])->values()->all();
                [$inputs, $extras] = $this->orderLines($order->lines()->get()->keyBy('id')->all(), array_values($lines), $delivery->id);
                $composed = $this->compose($header, $inputs, true, requireWarehouse: true);
            } else {
                [$inputs, $extras] = $lines === null ? [$this->storedLines($delivery->lines), $this->storedExtras($delivery)] : $this->directLines($lines);
                $composed = $this->compose($header, $inputs, $canOverridePrice, requireWarehouse: true);
                $this->assertStockLines($composed->lines);
                $this->logOverrides($delivery, $composed, $actor);
            }

            return $this->store->replace($delivery, $composed, [], $extras);
        });
    }

    public function delete(SalesDelivery $delivery, ?int $version): void
    {
        Sales::transaction(function () use ($delivery, $version): void {
            $delivery = $this->lock($delivery, $version);
            $this->assertDraft($delivery);

            if ($delivery->invoice_id !== null) {
                Messages::fail('document', 'delivery_belongs_to_invoice');
            }

            $delivery->delete();
        });
    }

    /**
     * Posts the delivery once: a posted delivery is returned unchanged (idempotent by state).
     *
     * @return array{0: SalesDelivery, 1: bool} the delivery and whether it had been posted before
     */
    public function post(SalesDelivery $delivery, ?int $version, ?Authenticatable $actor): array
    {
        return Sales::transaction(function () use ($delivery, $version, $actor): array {
            $order = $delivery->order_id === null ? null : $this->lockOrder($delivery->order_id);
            $delivery = $this->lock($delivery);

            if ($delivery->status === DeliveryStatus::Posted) {
                return [$delivery, true];
            }

            if ($version !== null) {
                $delivery->assertVersion($version);
            }

            $this->assertStatus($delivery, [DeliveryStatus::Draft], DeliveryStatus::Posted->value);

            return [$this->postLocked($delivery, $order, $actor), false];
        });
    }

    /**
     * Cancels a draft, or reverses a posted delivery that nothing has invoiced (stock back through
     * StockService::reverse on $date, order quantities reduced, the order's reservations renewed).
     * The actor is authorized against the locked delivery: update for a draft, reverse for a posted one.
     */
    public function cancel(SalesDelivery $delivery, ?int $version, ?string $reason, ?string $date, ?Authenticatable $actor, bool $fromInvoice = false): SalesDelivery
    {
        return Sales::transaction(function () use ($delivery, $version, $reason, $date, $actor, $fromInvoice): SalesDelivery {
            $order = $delivery->order_id === null ? null : $this->lockOrder($delivery->order_id);
            $delivery = $this->lock($delivery, $version);

            if ($delivery->status === DeliveryStatus::Cancelled) {
                return $delivery;
            }

            if ($delivery->invoice_id !== null && ! $fromInvoice) {
                Messages::fail('document', 'delivery_belongs_to_invoice');
            }

            if (! $fromInvoice && $actor !== null) {
                Gate::forUser($actor)->authorize($delivery->status === DeliveryStatus::Posted ? 'reverse' : 'update', $delivery);
            }

            $delivery->cancelled_at = now();
            $delivery->cancelled_by = self::actorId($actor);
            $delivery->cancel_reason = $reason;

            if ($delivery->status === DeliveryStatus::Draft) {
                return $this->machine->transition($delivery, DeliveryStatus::Cancelled, $actor);
            }

            $reason = trim((string) $reason);

            if ($reason === '') {
                Messages::fail('reason', 'reason_required');
            }

            $lines = $delivery->lines()->get();

            foreach ($lines as $line) {
                if (! $fromInvoice && $this->quantities->invoicedOnDelivery($line->id)->isPositive()) {
                    Messages::fail('document', 'delivery_invoiced');
                }
            }

            $reversalDate = $date ?? now()->toDateString();
            $reversed = $this->stock->reverse((string) $delivery->stock_document_id, new DateTimeImmutable($reversalDate), $reason);
            $delivery->reversal_stock_document_id = $reversed->documentId;
            $delivery->reversal_date = Carbon::parse($reversalDate);

            if ($order !== null) {
                $orderLines = $order->lines()->get()->keyBy('id');

                foreach ($lines as $line) {
                    $orderLine = $line->order_line_id === null ? null : $orderLines->get($line->order_line_id);

                    if ($orderLine instanceof SalesOrderLine) {
                        $this->progress->addDelivered($orderLine, $line->quantity->negated());
                        // The posting consumed (part of) the reservation: hold the open quantity again.
                        $this->reservations->releaseLine($order->company_id, $orderLine);
                    }
                }

                $this->progress->refresh($order, $actor);
                $this->rereserve($order, $actor);
            }

            return $this->machine->transition($delivery, DeliveryStatus::Cancelled, $actor);
        });
    }

    /**
     * Creates and posts the delivery of an invoice's stock lines (deliver_on_invoice), inside the
     * issue transaction; returns invoice line id => delivery line id.
     *
     * @param  list<SalesInvoiceLine>  $lines
     * @return array<string, string>
     */
    public function deliverForInvoice(SalesInvoice $invoice, array $lines, ?SalesOrder $order, ?Authenticatable $actor): array
    {
        $inputs = [];
        $extras = [];
        $orderLines = $order?->lines()->get()->keyBy('id');
        $requested = [];

        foreach ($lines as $i => $line) {
            $orderLine = $line->order_line_id === null ? null : $orderLines?->get($line->order_line_id);

            if ($orderLine instanceof SalesOrderLine) {
                $requested[$orderLine->id] = ($requested[$orderLine->id] ?? BigDecimal::zero())->plus($line->quantity);
                $this->assertWithinOrder($orderLine, $requested[$orderLine->id], null, "lines.{$i}.quantity");
            }

            $inputs[] = [...$this->fixedLine($line, (string) $line->quantity, true), 'source_line_id' => $line->id];
            $extras[] = ['order_line_id' => $orderLine?->id];
        }

        $header = $this->mergedHeader($invoice, []);
        $composed = $this->compose($header, $inputs, true, requireWarehouse: true);
        $delivery = $this->store->create(new SalesDelivery, $composed, [
            'order_id' => $order?->id, 'invoice_id' => $invoice->id, 'source_type' => 'sales_invoice', 'source_id' => $invoice->id,
        ], $extras, self::actorId($actor));
        $this->postLocked($this->lock($delivery), $order, $actor);
        $map = [];

        foreach ($delivery->lines()->get() as $i => $deliveryLine) {
            $map[$lines[$i]->id] = $deliveryLine->id;
        }

        return $map;
    }

    private function postLocked(SalesDelivery $delivery, ?SalesOrder $order, ?Authenticatable $actor): SalesDelivery
    {
        $lines = $delivery->lines()->get();
        $orderLines = $order?->lines()->get()->keyBy('id');

        if ($lines->isEmpty()) {
            Messages::fail('lines', 'lines_required');
        }

        $warehouseId = $delivery->warehouse_id ?? Messages::fail('warehouse_id', 'warehouse_required');

        if ($order !== null && $delivery->invoice_id === null) {
            $this->assertOrderOpen($order);
        }

        $stockLines = [];
        $requested = [];

        foreach ($lines as $i => $line) {
            if (! $line->isStock()) {
                Messages::fail("lines.{$i}.item_id", 'line_not_deliverable');
            }

            $orderLine = $line->order_line_id === null ? null : $orderLines?->get($line->order_line_id);

            if ($orderLine instanceof SalesOrderLine) {
                // Several lines of one order line count together.
                $requested[$orderLine->id] = ($requested[$orderLine->id] ?? BigDecimal::zero())->plus($line->quantity);
                $this->assertWithinOrder($orderLine, $requested[$orderLine->id], $delivery->id, "lines.{$i}.quantity", includeHeld: true);
            }

            $reservation = $orderLine instanceof SalesOrderLine && $orderLine->reservation_id !== null
                && ($orderLine->warehouse_id ?? $order->warehouse_id) === $warehouseId ? $orderLine->reservation_id : null;
            $stockLines[] = new StockPostingLine(
                itemId: $line->item_id,
                quantity: (string) $line->base_quantity,
                lotNo: $line->lot_no,
                serials: $line->serial_numbers,
                reservationId: $reservation,
            );
        }

        $this->store->assignNumber($delivery, DocumentKind::Delivery);
        $posted = $this->stock->post(new StockPostingRequest(
            $delivery->company_id, DocumentType::Issue, null, new DateTimeImmutable($delivery->document_date->format('Y-m-d')),
            $warehouseId, null, $stockLines, 'inventory.cogs', self::SOURCE_TYPE, $delivery->id,
            movementType: MovementType::Issue, reason: (string) $delivery->number, postedBy: self::actorId($actor),
        ));

        $costs = $this->lineCosts($posted);
        $total = BigDecimal::zero()->toScale(4);

        foreach ($lines as $line) {
            $cost = $costs[$line->line_no] ?? ['cost' => '0', 'lots' => null];
            $lineCost = Sales::dec($cost['cost'])->toScale(4, RoundingMode::HalfUp);
            $line->setAttribute('cost_total', (string) $lineCost);
            $line->setAttribute('unit_cost', (string) $lineCost->dividedBy($line->base_quantity, 6, RoundingMode::HalfUp));

            if ($line->lot_no === null && $cost['lots'] !== null && ! str_contains($cost['lots'], ',')) {
                $line->lot_no = $cost['lots'];
            }

            $line->save();
            $total = $total->plus($lineCost);
            $orderLine = $line->order_line_id === null ? null : $orderLines?->get($line->order_line_id);

            if ($orderLine instanceof SalesOrderLine) {
                $this->progress->addDelivered($orderLine, $line->quantity);
            }
        }

        if ($order !== null) {
            $this->progress->refresh($order, $actor);
        }

        $delivery->stock_document_id = $posted->documentId;
        $delivery->journal_entry_id = $posted->journalEntryId;
        $delivery->setAttribute('cost_total', (string) $total);
        $delivery->posted_at = now();
        $delivery->posted_by = self::actorId($actor);
        $this->machine->transition($delivery, DeliveryStatus::Posted, $actor);
        event(new SalesDeliveryPosted($delivery->company_id, $delivery->id, (string) $delivery->number, $delivery->order_id,
            $posted->documentId, $posted->journalEntryId, (string) $total));

        return $delivery;
    }

    /**
     * Cost and lots of each stock document line as reported by the posting.
     *
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

    /** Re-reserves the open quantities of an order still open (company setting and warehouse policy permitting). */
    private function rereserve(SalesOrder $order, ?Authenticatable $actor): void
    {
        if (! $this->settings->reserveOnConfirm() || ! in_array($order->status, OrderStatus::open(), true)) {
            return;
        }

        try {
            Sales::transaction(fn (): array => $this->reservations->reserve($order, self::actorId($actor)));
        } catch (ValidationException) {
            // A hard policy without enough free stock: the order stays without a reservation.
        }
    }

    /**
     * Order lines picked for a delivery, checked against the remaining quantity.
     *
     * @param  array<string, SalesOrderLine>  $orderLines
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function orderLines(array $orderLines, array $lines, ?string $exceptDeliveryId): array
    {
        $inputs = [];
        $extras = [];
        $seen = [];

        foreach ($lines as $i => $line) {
            $id = is_string($line['order_line_id'] ?? null) ? $line['order_line_id'] : '';
            $orderLine = $orderLines[$id] ?? null;

            if ($orderLine === null || isset($seen[$id])) {
                Messages::fail("lines.{$i}.order_line_id", 'source_line_unknown');
            }

            $seen[$id] = true;

            if (! $orderLine->isStock()) {
                Messages::fail("lines.{$i}.order_line_id", 'line_not_deliverable');
            }

            $qty = Sales::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
            $this->assertWithinOrder($orderLine, $qty, $exceptDeliveryId, "lines.{$i}.quantity");
            $inputs[] = [...$this->fixedLine($orderLine, (string) $qty), 'warehouse_id' => null, 'source_line_id' => $orderLine->id];
            $extras[] = [
                'order_line_id' => $orderLine->id,
                'lot_no' => is_string($line['lot_no'] ?? null) && $line['lot_no'] !== '' ? $line['lot_no'] : null,
                'serial_numbers' => array_values(array_map('strval', is_array($line['serial_numbers'] ?? null) ? $line['serial_numbers'] : [])),
            ];
        }

        return [$inputs, $extras];
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function directLines(array $lines): array
    {
        $extras = [];

        foreach ($lines as $line) {
            $extras[] = [
                'lot_no' => is_string($line['lot_no'] ?? null) && $line['lot_no'] !== '' ? $line['lot_no'] : null,
                'serial_numbers' => array_values(array_map('strval', is_array($line['serial_numbers'] ?? null) ? $line['serial_numbers'] : [])),
            ];
        }

        $inputs = array_map(static fn (array $l): array => [...array_diff_key($l, ['lot_no' => 1, 'serial_numbers' => 1, 'order_line_id' => 1]), 'warehouse_id' => null], $lines);

        return [$inputs, $extras];
    }

    /** @return list<array<string, mixed>> */
    private function storedExtras(SalesDelivery $delivery): array
    {
        return array_values($delivery->lines->map(fn (SalesDeliveryLine $l): array => ['lot_no' => $l->lot_no, 'serial_numbers' => $l->serial_numbers])->all());
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function assertStockLines(array $lines): void
    {
        foreach ($lines as $i => $line) {
            if (($line['item_type'] ?? null) !== 'stock') {
                Messages::fail("lines.{$i}.item_id", 'line_not_deliverable');
            }
        }
    }

    /**
     * Ordered quantity plus the tolerance must cover what deliveries (drafts included) hold.
     */
    private function assertWithinOrder(SalesOrderLine $line, BigDecimal $qty, ?string $exceptDeliveryId, string $field, bool $includeHeld = true): void
    {
        $allowed = $line->quantity->multipliedBy(BigDecimal::of(100 + $this->settings->overDeliveryPercent()))->dividedBy(100, 6, RoundingMode::Down);
        $held = $includeHeld ? $this->quantities->deliveredOrHeld($line->id, $exceptDeliveryId) : BigDecimal::zero();

        if ($held->plus($qty)->isGreaterThan($allowed)) {
            $remaining = $allowed->minus($held);
            Messages::fail($field, 'delivery_exceeds_order', ['remaining' => Sales::qty($remaining->isNegative() ? '0' : $remaining)]);
        }
    }

    private function assertOrderOpen(SalesOrder $order): void
    {
        if (! in_array($order->status, OrderStatus::open(), true)) {
            Messages::fail('order', 'order_not_open');
        }
    }

    private function lockOrder(string $orderId): SalesOrder
    {
        return SalesOrder::query()->whereKey($orderId)->lockForUpdate()->firstOrFail();
    }
}
