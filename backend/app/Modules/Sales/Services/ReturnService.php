<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Data\StockPostingRequest;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Sales\Enums\DocumentKind;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Enums\ReturnStatus;
use App\Modules\Sales\Events\SalesReturnCredited;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesDeliveryLine;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesInvoiceLine;
use App\Modules\Sales\Models\SalesReturn;
use App\Modules\Sales\Models\SalesReturnLine;
use App\Modules\Sales\Services\Composer\DocumentComposer;
use App\Modules\Sales\Services\Machines\ReturnMachine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Returns against an issued invoice, bounded by the invoiced quantity minus earlier returns (under
 * the invoice row lock). Receiving posts return_in movements at the delivery's unit cost through
 * StockService with offset inventory.cogs, which books the COGS reversal together with the stock;
 * crediting issues the credit note (sales.returns, VAT and receivable mirrored).
 */
final class ReturnService extends DocumentService
{
    public const string SOURCE_TYPE = 'sales_return';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly ReturnMachine $machine,
        private readonly StockService $stock,
        private readonly Quantities $quantities,
        private readonly InvoiceService $invoices,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data  document_date, warehouse_id, reason, notes
     * @param  list<array<string, mixed>>|null  $lines  invoice_line_id, quantity, lot_no, serial_numbers; null = everything returnable
     */
    public function createFromInvoice(SalesInvoice $invoice, array $data, ?array $lines, ?Authenticatable $actor): SalesReturn
    {
        return Sales::transaction(function () use ($invoice, $data, $lines, $actor): SalesReturn {
            $invoice = $this->lockInvoice($invoice->id);

            if ($lines === null) {
                $lines = [];

                foreach ($invoice->lines()->get() as $line) {
                    $open = $line->quantity->minus($this->quantities->returned($line->id));

                    if ($open->isPositive()) {
                        $lines[] = ['invoice_line_id' => $line->id, 'quantity' => (string) $open];
                    }
                }

                if ($lines === []) {
                    Messages::fail('lines', 'nothing_to_return');
                }
            }

            [$inputs, $extras] = $this->invoiceLines($invoice, $lines, null);
            $composed = $this->compose($this->returnHeader($invoice, $data), $inputs, true);

            return $this->store->create(new SalesReturn, $composed, [
                'invoice_id' => $invoice->id, 'reason' => $data['reason'] ?? null, 'source_type' => 'sales_invoice', 'source_id' => $invoice->id,
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(SalesReturn $return, array $data, ?array $lines, int $version): SalesReturn
    {
        return Sales::transaction(function () use ($return, $data, $lines, $version): SalesReturn {
            $invoice = $this->lockInvoice($return->invoice_id);
            $return = $this->lock($return, $version);
            $this->assertDraft($return);
            $lines ??= $return->lines->map(fn (SalesReturnLine $l): array => [
                'invoice_line_id' => $l->invoice_line_id, 'quantity' => (string) $l->quantity, 'lot_no' => $l->lot_no, 'serial_numbers' => $l->serial_numbers,
            ])->values()->all();
            [$inputs, $extras] = $this->invoiceLines($invoice, array_values($lines), $return->id);
            $header = $this->returnHeader($invoice, [
                'document_date' => $data['document_date'] ?? $return->document_date->format('Y-m-d'),
                'warehouse_id' => array_key_exists('warehouse_id', $data) ? $data['warehouse_id'] : $return->warehouse_id,
                'notes' => array_key_exists('notes', $data) ? $data['notes'] : $return->notes,
                'internal_notes' => array_key_exists('internal_notes', $data) ? $data['internal_notes'] : $return->internal_notes,
            ]);
            $composed = $this->compose($header, $inputs, true);

            return $this->store->replace($return, $composed, array_key_exists('reason', $data) ? ['reason' => $data['reason']] : [], $extras);
        });
    }

    public function delete(SalesReturn $return, ?int $version): void
    {
        Sales::transaction(function () use ($return, $version): void {
            $return = $this->lock($return, $version);
            $this->assertDraft($return);
            $return->delete();
        });
    }

    public function approve(SalesReturn $return, ?int $version, ?Authenticatable $actor): SalesReturn
    {
        return Sales::transaction(function () use ($return, $version, $actor): SalesReturn {
            $invoice = $this->lockInvoice($return->invoice_id);
            $return = $this->lock($return, $version);
            $this->assertStatus($return, [ReturnStatus::Draft], ReturnStatus::Approved->value);
            $this->invoiceLines($invoice, $this->linesAsInput($return), $return->id);
            $this->store->assignNumber($return, DocumentKind::SalesReturn);
            $return->approved_at = now();
            $return->approved_by = self::actorId($actor);

            return $this->machine->transition($return, ReturnStatus::Approved, $actor);
        });
    }

    public function cancel(SalesReturn $return, ?int $version, ?Authenticatable $actor): SalesReturn
    {
        return Sales::transaction(function () use ($return, $version, $actor): SalesReturn {
            $return = $this->lock($return, $version);
            $this->assertStatus($return, [ReturnStatus::Draft, ReturnStatus::Approved], ReturnStatus::Cancelled->value);
            $return->cancelled_at = now();

            return $this->machine->transition($return, ReturnStatus::Cancelled, $actor);
        });
    }

    /**
     * Takes the goods back into stock at their delivery cost; idempotent by state.
     *
     * @return array{0: SalesReturn, 1: bool}
     */
    public function receive(SalesReturn $return, ?int $version, ?Authenticatable $actor): array
    {
        return Sales::transaction(function () use ($return, $version, $actor): array {
            $return = $this->lock($return);

            if (in_array($return->status, [ReturnStatus::Received, ReturnStatus::Credited], true)) {
                return [$return, true];
            }

            if ($version !== null) {
                $return->assertVersion($version);
            }

            $this->assertStatus($return, [ReturnStatus::Approved], ReturnStatus::Received->value);
            $lines = $return->lines()->get();
            $stockLines = [];
            $posting = [];

            foreach ($lines as $i => $line) {
                if (! $line->isStock() || $line->delivery_line_id === null) {
                    continue;
                }

                if ($line->unit_cost === null) {
                    Messages::fail("lines.{$i}.unit_cost", 'return_cost_unknown');
                }

                $stockLines[] = new StockPostingLine(
                    itemId: $line->item_id,
                    quantity: (string) $line->base_quantity,
                    unitCost: (string) $line->unit_cost,
                    lotNo: $line->lot_no,
                    serials: $line->serial_numbers,
                );
                $posting[] = $line;
            }

            if ($stockLines !== []) {
                $warehouse = $return->warehouse_id ?? $this->deliveryWarehouse($posting[0]);

                if ($warehouse === null) {
                    Messages::fail('warehouse_id', 'warehouse_required');
                }

                $posted = $this->stock->post(new StockPostingRequest(
                    $return->company_id, DocumentType::Receipt, null, new DateTimeImmutable($return->document_date->format('Y-m-d')),
                    $warehouse, null, $stockLines, 'inventory.cogs', self::SOURCE_TYPE, $return->id,
                    movementType: MovementType::ReturnIn, reason: (string) $return->number, postedBy: self::actorId($actor),
                ));
                $return->stock_document_id = $posted->documentId;
                $return->journal_entry_id = $posted->journalEntryId;
                $return->warehouse_id = $warehouse;
            }

            $return->received_at = now();
            $return->received_by = self::actorId($actor);

            return [$this->machine->transition($return, ReturnStatus::Received, $actor), false];
        });
    }

    /**
     * Issues the credit note of a received return; idempotent by state.
     *
     * @return array{0: SalesReturn, 1: bool}
     */
    public function credit(SalesReturn $return, ?int $version, ?Authenticatable $actor): array
    {
        return Sales::transaction(function () use ($return, $version, $actor): array {
            $invoice = $this->lockInvoice($return->invoice_id);
            $return = $this->lock($return);

            if ($return->status === ReturnStatus::Credited) {
                return [$return, true];
            }

            if ($version !== null) {
                $return->assertVersion($version);
            }

            $this->assertStatus($return, [ReturnStatus::Received], ReturnStatus::Credited->value);
            $credit = $this->invoices->creditReturn($return, $invoice, $actor);
            $return->credit_invoice_id = $credit->id;
            $return->credited_at = now();
            $return->credited_by = self::actorId($actor);
            $this->machine->transition($return, ReturnStatus::Credited, $actor);
            event(new SalesReturnCredited($return->company_id, $return->id, (string) $return->number, $credit->id, $invoice->id));

            return [$return, false];
        });
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function invoiceLines(SalesInvoice $invoice, array $lines, ?string $exceptReturnId): array
    {
        $invoiceLines = $invoice->lines()->get()->keyBy('id');
        $inputs = [];
        $extras = [];
        $seen = [];

        foreach ($lines as $i => $line) {
            $id = is_string($line['invoice_line_id'] ?? null) ? $line['invoice_line_id'] : '';
            $source = $invoiceLines->get($id);

            if (! $source instanceof SalesInvoiceLine || isset($seen[$id])) {
                Messages::fail("lines.{$i}.invoice_line_id", 'source_line_unknown');
            }

            $seen[$id] = true;
            $qty = Sales::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
            $returned = $this->quantities->returned($source->id, $exceptReturnId);

            if ($returned->plus($qty)->isGreaterThan($source->quantity)) {
                Messages::fail("lines.{$i}.quantity", 'return_exceeds_invoiced', ['remaining' => Sales::qty($source->quantity->minus($returned))]);
            }

            $delivery = $source->delivery_line_id === null ? null : SalesDeliveryLine::query()->whereKey($source->delivery_line_id)->first();
            $serials = array_values(array_map('strval', is_array($line['serial_numbers'] ?? null) ? $line['serial_numbers'] : []));

            if ($serials === [] && $delivery !== null && $delivery->serial_numbers !== [] && $qty->isEqualTo($delivery->quantity)) {
                $serials = $delivery->serial_numbers;
            }

            $this->assertSerials($serials, $delivery, $qty, $exceptReturnId, "lines.{$i}.serial_numbers");

            $lot = is_string($line['lot_no'] ?? null) && $line['lot_no'] !== '' ? $line['lot_no'] : $delivery?->lot_no;
            $unitCost = $delivery?->unit_cost;
            $baseQty = $source->base_quantity->multipliedBy($qty)->dividedBy($source->quantity, 6, RoundingMode::HalfUp);
            $inputs[] = [...$this->fixedLine($source, (string) $qty, true), 'source_line_id' => $source->id, 'warehouse_id' => null];
            $extras[] = [
                'invoice_line_id' => $source->id,
                'delivery_line_id' => $delivery?->id,
                'lot_no' => $lot,
                'serial_numbers' => $serials,
                'unit_cost' => $unitCost === null ? null : (string) $unitCost,
                'cost_total' => $unitCost === null ? null : (string) $unitCost->multipliedBy($baseQty)->toScale(4, RoundingMode::HalfUp),
            ];
        }

        return [$inputs, $extras];
    }

    /**
     * Serial numbers coming back must be ones the original delivery shipped, one per unit, and not
     * held by another return that is not cancelled.
     *
     * @param  list<string>  $serials
     */
    private function assertSerials(array $serials, ?SalesDeliveryLine $delivery, BigDecimal $qty, ?string $exceptReturnId, string $field): void
    {
        $shipped = $delivery === null ? [] : $delivery->serial_numbers;

        if ($shipped === []) {
            if ($serials !== []) {
                Messages::fail($field, 'return_serial_unknown');
            }

            return;
        }

        if (count($serials) !== count(array_unique($serials)) || ! $qty->isEqualTo(count($serials))) {
            Messages::fail($field, 'return_serial_count');
        }

        if (array_diff($serials, $shipped) !== []) {
            Messages::fail($field, 'return_serial_unknown');
        }

        $taken = [];

        foreach (SalesReturnLine::query()->where('delivery_line_id', $delivery->id)
            ->whereIn('document_id', SalesReturn::query()->select('id')->where('status', '<>', ReturnStatus::Cancelled->value)
                ->when($exceptReturnId !== null, fn ($q) => $q->whereKeyNot($exceptReturnId)))
            ->get() as $other) {
            $taken = [...$taken, ...$other->serial_numbers];
        }

        if (array_intersect($serials, $taken) !== []) {
            Messages::fail($field, 'return_serial_taken');
        }
    }

    /** @return list<array<string, mixed>> */
    private function linesAsInput(SalesReturn $return): array
    {
        return array_values($return->lines()->get()->map(fn (SalesReturnLine $l): array => [
            'invoice_line_id' => $l->invoice_line_id, 'quantity' => (string) $l->quantity, 'lot_no' => $l->lot_no, 'serial_numbers' => $l->serial_numbers,
        ])->all());
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function returnHeader(SalesInvoice $invoice, array $data): array
    {
        $header = $this->mergedHeader($invoice, array_intersect_key($data, array_flip(['warehouse_id', 'notes', 'internal_notes'])));
        $header['document_date'] = $data['document_date'] ?? now()->toDateString();
        $header['fx_rate'] = (string) $invoice->fx_rate;
        $header['due_date'] = $header['document_date'];

        return $header;
    }

    private function deliveryWarehouse(SalesReturnLine $line): ?string
    {
        $deliveryLine = $line->delivery_line_id === null ? null : SalesDeliveryLine::query()->whereKey($line->delivery_line_id)->first();

        return $deliveryLine === null ? null : SalesDelivery::query()->whereKey($deliveryLine->document_id)->value('warehouse_id');
    }

    private function lockInvoice(string $invoiceId, bool $booked = true): SalesInvoice
    {
        $invoice = SalesInvoice::query()->whereKey($invoiceId)->lockForUpdate()->firstOrFail();

        if ($invoice->isCreditNote() || ($booked && ! in_array($invoice->status->value, InvoiceStatus::booked(), true))) {
            Messages::fail('invoice', 'invoice_not_returnable');
        }

        return $invoice;
    }
}
