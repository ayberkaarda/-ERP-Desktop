<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Inventory\Contracts\StockService;
use App\Modules\Inventory\Data\StockPostingLine;
use App\Modules\Inventory\Data\StockPostingRequest;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Events\PurchaseReturnDebited;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseInvoiceLine;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseReceiptLine;
use App\Modules\Purchasing\Models\PurchaseReturn;
use App\Modules\Purchasing\Models\PurchaseReturnLine;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Services\Machines\ReturnMachine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Returns to the supplier. From a booked invoice: bounded by the invoiced quantity minus earlier
 * returns (under the invoice row lock), shipped, then debited with a debit note. From a posted
 * receipt: only the part not yet invoiced or returned (under the receipt row lock); shipping
 * completes it and the receipt can be invoiced only for what stayed.
 * Shipping takes the goods out through StockService (return_out, offset purchase.goods_received).
 * The stock leaves at its valuation cost; the difference to the goods receipt cost of the same
 * quantity is booked between the goods received not invoiced account and purchase.price_variance,
 * so the accrual moves by the receipt cost exactly as the debit note (or the later invoice) expects.
 */
final class ReturnService extends DocumentService
{
    public const string SOURCE_TYPE = 'purchase_return';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly ReturnMachine $machine,
        private readonly StockService $stock,
        private readonly PostingService $posting,
        private readonly AccountDeterminer $accounts,
        private readonly ItemLookup $items,
        private readonly Quantities $quantities,
        private readonly InvoiceService $invoices,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data  document_date, warehouse_id, reason, notes
     * @param  list<array<string, mixed>>|null  $lines  invoice_line_id, quantity, lot_no, serial_numbers; null = everything returnable
     */
    public function createFromInvoice(PurchaseInvoice $invoice, array $data, ?array $lines, ?Authenticatable $actor): PurchaseReturn
    {
        return Purchasing::transaction(function () use ($invoice, $data, $lines, $actor): PurchaseReturn {
            $invoice = $this->lockInvoice($invoice->id);

            if ($lines === null) {
                $lines = [];

                foreach ($invoice->lines()->get() as $line) {
                    $open = $line->quantity->minus($this->quantities->returnedOnInvoice($line->id));

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

            return $this->store->create(new PurchaseReturn, $composed, [
                'invoice_id' => $invoice->id, 'reason' => $data['reason'] ?? null, 'source_type' => 'purchase_invoice', 'source_id' => $invoice->id,
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines  receipt_line_id, quantity, lot_no, serial_numbers; null = everything still open
     */
    public function createFromReceipt(PurchaseReceipt $receipt, array $data, ?array $lines, ?Authenticatable $actor): PurchaseReturn
    {
        return Purchasing::transaction(function () use ($receipt, $data, $lines, $actor): PurchaseReturn {
            $receipt = $this->lockReceipt($receipt->id);

            if ($lines === null) {
                $lines = [];

                foreach ($receipt->lines()->get() as $line) {
                    $open = $this->quantities->openOnReceipt($line->id, $line->quantity);

                    if ($open->isPositive()) {
                        $lines[] = ['receipt_line_id' => $line->id, 'quantity' => (string) $open];
                    }
                }

                if ($lines === []) {
                    Messages::fail('lines', 'nothing_to_return');
                }
            }

            [$inputs, $extras] = $this->receiptLines($receipt, $lines, null);
            $header = $this->mergedHeader($receipt, ['document_date' => $data['document_date'] ?? now()->toDateString()]);
            $header['warehouse_id'] = $data['warehouse_id'] ?? $receipt->warehouse_id;
            $header['notes'] = $data['notes'] ?? null;
            $composed = $this->compose($header, $inputs, true);

            return $this->store->create(new PurchaseReturn, $composed, [
                'receipt_id' => $receipt->id, 'reason' => $data['reason'] ?? null, 'source_type' => 'purchase_receipt', 'source_id' => $receipt->id,
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(PurchaseReturn $return, array $data, ?array $lines, int $version): PurchaseReturn
    {
        return Purchasing::transaction(function () use ($return, $data, $lines, $version): PurchaseReturn {
            $source = $this->lockSource($return);
            $return = $this->lock($return, $version);
            $this->assertDraft($return);
            $lines ??= $this->linesAsInput($return);
            $base = [
                'document_date' => $data['document_date'] ?? $return->document_date->format('Y-m-d'),
                'warehouse_id' => array_key_exists('warehouse_id', $data) ? $data['warehouse_id'] : $return->warehouse_id,
                'notes' => array_key_exists('notes', $data) ? $data['notes'] : $return->notes,
                'internal_notes' => array_key_exists('internal_notes', $data) ? $data['internal_notes'] : $return->internal_notes,
            ];

            if ($source instanceof PurchaseInvoice) {
                [$inputs, $extras] = $this->invoiceLines($source, $lines, $return->id);
                $header = $this->returnHeader($source, $base);
            } else {
                [$inputs, $extras] = $this->receiptLines($source, $lines, $return->id);
                $header = [...$this->mergedHeader($source, ['document_date' => $base['document_date']]), 'warehouse_id' => $base['warehouse_id'] ?? $source->warehouse_id,
                    'notes' => $base['notes'], 'internal_notes' => $base['internal_notes']];
            }

            $composed = $this->compose($header, $inputs, true);

            return $this->store->replace($return, $composed, array_key_exists('reason', $data) ? ['reason' => $data['reason']] : [], $extras);
        });
    }

    public function delete(PurchaseReturn $return, ?int $version): void
    {
        Purchasing::transaction(function () use ($return, $version): void {
            $return = $this->lock($return, $version);
            $this->assertDraft($return);
            $return->delete();
        });
    }

    public function approve(PurchaseReturn $return, ?int $version, ?Authenticatable $actor): PurchaseReturn
    {
        return Purchasing::transaction(function () use ($return, $version, $actor): PurchaseReturn {
            $source = $this->lockSource($return);
            $return = $this->lock($return, $version);
            $this->assertStatus($return, [ReturnStatus::Draft], ReturnStatus::Approved->value);

            if ($source instanceof PurchaseInvoice) {
                $this->invoiceLines($source, $this->linesAsInput($return), $return->id);
            } else {
                $this->receiptLines($source, $this->linesAsInput($return), $return->id);
            }

            $this->store->assignNumber($return, DocumentKind::PurchaseReturn);
            $return->approved_at = now();
            $return->approved_by = self::actorId($actor);

            return $this->machine->transition($return, ReturnStatus::Approved, $actor);
        });
    }

    public function cancel(PurchaseReturn $return, ?int $version, ?Authenticatable $actor): PurchaseReturn
    {
        return Purchasing::transaction(function () use ($return, $version, $actor): PurchaseReturn {
            $return = $this->lock($return, $version);
            $this->assertStatus($return, [ReturnStatus::Draft, ReturnStatus::Approved], ReturnStatus::Cancelled->value);
            $return->cancelled_at = now();

            return $this->machine->transition($return, ReturnStatus::Cancelled, $actor);
        });
    }

    /**
     * Sends the goods back: return_out movements and the receipt-cost correction; idempotent by state.
     *
     * @return array{0: PurchaseReturn, 1: bool}
     */
    public function ship(PurchaseReturn $return, ?int $version, ?Authenticatable $actor): array
    {
        return Purchasing::transaction(function () use ($return, $version, $actor): array {
            $this->lockSource($return);
            $return = $this->lock($return);

            if (in_array($return->status, [ReturnStatus::Shipped, ReturnStatus::Debited], true)) {
                return [$return, true];
            }

            if ($version !== null) {
                $return->assertVersion($version);
            }

            $this->assertStatus($return, [ReturnStatus::Approved], ReturnStatus::Shipped->value);
            $lines = $return->lines()->get();
            $stockLines = [];
            $posting = [];
            $receiptLines = PurchaseReceiptLine::query()->whereIn('id', $lines->pluck('receipt_line_id')->filter()->values()->all())->get()->keyBy('id');

            foreach ($lines as $line) {
                $receiptLine = $line->receipt_line_id === null ? null : $receiptLines->get($line->receipt_line_id);

                if (! $line->isStock() || ! $receiptLine instanceof PurchaseReceiptLine) {
                    continue;
                }

                $stockLines[] = new StockPostingLine(
                    itemId: $line->item_id,
                    quantity: (string) $line->base_quantity,
                    lotNo: $line->lot_no ?? $receiptLine->lot_no,
                    serials: $line->serial_numbers,
                );
                $posting[] = [$line, $receiptLine];
            }

            if ($stockLines !== []) {
                $warehouse = $return->warehouse_id ?? $this->receiptWarehouse($posting[0][1]);

                if ($warehouse === null) {
                    Messages::fail('warehouse_id', 'warehouse_required');
                }

                $posted = $this->stock->post(new StockPostingRequest(
                    $return->company_id, DocumentType::Issue, null, new DateTimeImmutable($return->document_date->format('Y-m-d')),
                    $warehouse, null, $stockLines, ReceiptService::GRNI_EVENT, self::SOURCE_TYPE, $return->id,
                    movementType: MovementType::ReturnOut, reason: (string) $return->number, postedBy: self::actorId($actor),
                ));
                $costs = [];

                foreach ($posted->lines as $postedLine) {
                    $costs[$postedLine->lineNo] = $postedLine->totalCost;
                }

                $corrections = [];

                foreach ($posting as $n => [$line, $receiptLine]) {
                    /** @var PurchaseReturnLine $line */
                    /** @var PurchaseReceiptLine $receiptLine */
                    $cost = Purchasing::dec($costs[$n + 1] ?? '0')->toScale(4, RoundingMode::HalfUp);
                    $receiptCost = ($receiptLine->cost_total ?? BigDecimal::zero())->multipliedBy($line->base_quantity)
                        ->dividedBy($receiptLine->base_quantity, 4, RoundingMode::HalfUp);
                    $line->setAttribute('cost_total', (string) $cost);
                    $line->setAttribute('unit_cost', (string) $cost->dividedBy($line->base_quantity, 6, RoundingMode::HalfUp));
                    $line->setAttribute('receipt_cost', (string) $receiptCost);
                    $line->save();
                    $corrections[] = [$line, $receiptCost->minus($cost), $warehouse];
                }

                $return->stock_document_id = $posted->documentId;
                $return->journal_entry_id = $this->bookCorrection($return, $corrections, $actor) ?? $posted->journalEntryId;
            }

            $return->shipped_at = now();
            $return->shipped_by = self::actorId($actor);

            return [$this->machine->transition($return, ReturnStatus::Shipped, $actor), false];
        });
    }

    /**
     * Debits a shipped return of an invoice with a debit note (booked at once); idempotent by state.
     *
     * @return array{0: PurchaseReturn, 1: bool}
     */
    public function debit(PurchaseReturn $return, ?int $version, ?Authenticatable $actor): array
    {
        return Purchasing::transaction(function () use ($return, $version, $actor): array {
            if ($return->invoice_id === null) {
                Messages::fail('document', 'return_not_invoiced');
            }

            $original = $this->lockInvoice($return->invoice_id);
            $return = $this->lock($return);

            if ($return->status === ReturnStatus::Debited) {
                return [$return, true];
            }

            if ($version !== null) {
                $return->assertVersion($version);
            }

            $this->assertStatus($return, [ReturnStatus::Shipped], ReturnStatus::Debited->value);
            $debit = $this->invoices->debitReturn($return, $original, $actor);
            $return->debit_invoice_id = $debit->id;
            $return->debited_at = now();
            $return->debited_by = self::actorId($actor);
            $this->machine->transition($return, ReturnStatus::Debited, $actor);
            event(new PurchaseReturnDebited($return->company_id, $return->id, (string) $return->number, $debit->id, (string) $debit->total_local));

            return [$return, false];
        });
    }

    /**
     * Moves the difference between the receipt cost and the stock cost of the shipped goods from
     * purchase.price_variance to the goods received not invoiced account.
     *
     * @param  list<array{0: PurchaseReturnLine, 1: BigDecimal, 2: string}>  $corrections
     */
    private function bookCorrection(PurchaseReturn $return, array $corrections, ?Authenticatable $actor): ?string
    {
        $sides = [];

        foreach ($corrections as [$line, $amount, $warehouse]) {
            if ($amount->isZero()) {
                continue;
            }

            $category = $this->items->find($line->item_id)?->categoryId;
            $context = array_filter(['item_id' => $line->item_id, 'item_category' => $category, 'warehouse_id' => $warehouse], static fn (?string $v): bool => $v !== null);
            $grni = $this->accounts->resolve(ReceiptService::GRNI_EVENT, $context)->id;
            $variance = $this->accounts->resolve('purchase.price_variance', [...$context, 'party_id' => $return->party_id])->id;
            $sides[$grni] = ($sides[$grni] ?? BigDecimal::zero())->plus($amount);
            $sides[$variance] = ($sides[$variance] ?? BigDecimal::zero())->minus($amount);
        }

        $lines = [];
        $description = Messages::get('journal_return_cost', ['number' => (string) $return->number]);

        foreach ($sides as $account => $amount) {
            if ($amount->isZero()) {
                continue;
            }

            $extra = ['documentRef' => $return->number, 'description' => $description];
            $lines[] = $amount->isPositive() ? PostingLine::debit($account, (string) $amount->toScale(4), $extra) : PostingLine::credit($account, (string) $amount->abs()->toScale(4), $extra);
        }

        if ($lines === []) {
            return null;
        }

        return $this->posting->post(new PostingRequest(
            $return->company_id, new DateTimeImmutable($return->document_date->format('Y-m-d')), EntryType::System, $description,
            self::SOURCE_TYPE, $return->id, $lines, 'cost_variance', self::actorId($actor),
        ))->id;
    }

    /**
     * Invoice lines picked for a return, bounded by what is not yet returned.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function invoiceLines(PurchaseInvoice $invoice, array $lines, ?string $exceptReturnId): array
    {
        if ($invoice->isDebitNote() || ! in_array($invoice->status->value, InvoiceStatus::booked(), true)) {
            Messages::fail('invoice', 'invoice_not_returnable');
        }

        $invoiceLines = $invoice->lines()->get()->keyBy('id');
        $inputs = [];
        $extras = [];
        $requested = [];

        foreach ($lines as $i => $line) {
            $source = $invoiceLines->get(is_string($line['invoice_line_id'] ?? null) ? $line['invoice_line_id'] : '');

            if (! $source instanceof PurchaseInvoiceLine) {
                Messages::fail("lines.{$i}.invoice_line_id", 'source_line_unknown');
            }

            $qty = Purchasing::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
            $requested[$source->id] = ($requested[$source->id] ?? BigDecimal::zero())->plus($qty);
            $open = $source->quantity->minus($this->quantities->returnedOnInvoice($source->id, $exceptReturnId));

            if (! $qty->isPositive() || $requested[$source->id]->isGreaterThan($open)) {
                Messages::fail("lines.{$i}.quantity", 'return_exceeds_invoiced', ['remaining' => Purchasing::qty($open->isNegative() ? '0' : $open)]);
            }

            $inputs[] = [...$this->fixedLine($source, (string) $qty, true), 'source_line_id' => $source->id];
            $extras[] = [
                'invoice_line_id' => $source->id, 'receipt_line_id' => $source->receipt_line_id,
                'lot_no' => DocumentComposer::str($line['lot_no'] ?? null),
                'serial_numbers' => array_values(array_map('strval', is_array($line['serial_numbers'] ?? null) ? $line['serial_numbers'] : [])),
            ];
        }

        return [$inputs, $extras];
    }

    /**
     * Receipt lines picked for a return, bounded by what is neither invoiced nor returned.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function receiptLines(PurchaseReceipt $receipt, array $lines, ?string $exceptReturnId): array
    {
        if ($receipt->status !== ReceiptStatus::Posted) {
            Messages::fail('receipt', 'receipt_not_posted');
        }

        $receiptLines = $receipt->lines()->get()->keyBy('id');
        $inputs = [];
        $extras = [];
        $requested = [];

        foreach ($lines as $i => $line) {
            $source = $receiptLines->get(is_string($line['receipt_line_id'] ?? null) ? $line['receipt_line_id'] : '');

            if (! $source instanceof PurchaseReceiptLine) {
                Messages::fail("lines.{$i}.receipt_line_id", 'source_line_unknown');
            }

            $qty = Purchasing::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
            $requested[$source->id] = ($requested[$source->id] ?? BigDecimal::zero())->plus($qty);
            $open = $this->quantities->openOnReceipt($source->id, $source->quantity, null, $exceptReturnId);

            if (! $qty->isPositive() || $requested[$source->id]->isGreaterThan($open)) {
                Messages::fail("lines.{$i}.quantity", 'return_exceeds_received', ['remaining' => Purchasing::qty($open->isNegative() ? '0' : $open)]);
            }

            $inputs[] = [...$this->fixedLine($source, (string) $qty, true), 'source_line_id' => $source->id];
            $extras[] = [
                'invoice_line_id' => null, 'receipt_line_id' => $source->id,
                'lot_no' => DocumentComposer::str($line['lot_no'] ?? null) ?? $source->lot_no,
                'serial_numbers' => array_values(array_map('strval', is_array($line['serial_numbers'] ?? null) ? $line['serial_numbers'] : [])),
            ];
        }

        return [$inputs, $extras];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function returnHeader(PurchaseInvoice $invoice, array $data): array
    {
        $header = $this->mergedHeader($invoice, ['document_date' => $data['document_date'] ?? now()->toDateString()]);
        $header['fx_rate'] = (string) $invoice->fx_rate;
        $header['warehouse_id'] = $data['warehouse_id'] ?? $invoice->warehouse_id;
        $header['notes'] = $data['notes'] ?? null;
        $header['internal_notes'] = $data['internal_notes'] ?? null;
        unset($header['due_date']);

        return $header;
    }

    /** @return list<array<string, mixed>> */
    private function linesAsInput(PurchaseReturn $return): array
    {
        return array_values($return->lines()->get()->map(static fn (PurchaseReturnLine $l): array => array_filter([
            'invoice_line_id' => $l->invoice_line_id, 'receipt_line_id' => $l->invoice_line_id === null ? $l->receipt_line_id : null,
            'quantity' => (string) $l->quantity, 'lot_no' => $l->lot_no, 'serial_numbers' => $l->serial_numbers,
        ], static fn (mixed $v): bool => $v !== null))->all());
    }

    private function lockSource(PurchaseReturn $return): PurchaseInvoice|PurchaseReceipt
    {
        if ($return->invoice_id !== null) {
            return $this->lockInvoice($return->invoice_id);
        }

        return $this->lockReceipt((string) $return->receipt_id);
    }

    private function receiptWarehouse(PurchaseReceiptLine $line): ?string
    {
        $warehouse = PurchaseReceipt::query()->whereKey($line->document_id)->value('warehouse_id');

        return is_string($warehouse) ? $warehouse : null;
    }

    private function lockInvoice(string $id): PurchaseInvoice
    {
        return PurchaseInvoice::query()->whereKey($id)->lockForUpdate()->firstOrFail();
    }

    private function lockReceipt(string $id): PurchaseReceipt
    {
        return PurchaseReceipt::query()->whereKey($id)->lockForUpdate()->firstOrFail();
    }
}
