<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostedEntry;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Models\PurchaseInvoiceLine;
use App\Modules\Purchasing\Models\PurchaseReceipt;
use App\Modules\Purchasing\Models\PurchaseReceiptLine;
use App\Modules\Purchasing\Models\PurchaseReturnLine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The journal entry of a supplier invoice, in company currency, through PostingService (source
 * purchase_invoice, purpose main, so a repeated booking cannot book twice):
 *   purchase: Dr purchase.goods_received  receipt value of the received lines (clears the accrual)
 *             Dr purchase.expense         lines without a receipt (services, non-stock)
 *             Dr/Cr purchase.price_variance  net of the received lines minus their receipt value
 *             Dr purchase.vat_input       per tax code
 *             Cr purchase.payable         total less withheld VAT (party, due date, currency data)
 *             Cr purchase.vat_withholding withheld VAT (tevkifat)
 *   debit note: the mirror; received lines clear the receipt value of the returned goods.
 * VAT per tax code is the document tax converted and rounded; the net is the total minus VAT,
 * split over the lines by their net amounts, so the entry balances and equals the invoice. The
 * receipt value of a line is its share of the receipt line cost; the line that consumes the rest of
 * a receipt line takes exactly what is left, so the accrual of a fully invoiced receipt is zero.
 */
final class InvoiceJournal
{
    public const string SOURCE_TYPE = 'purchase_invoice';

    public function __construct(
        private readonly PostingService $posting,
        private readonly AccountDeterminer $accounts,
        private readonly ItemLookup $items,
        private readonly PurchasingSettings $settings,
    ) {}

    /**
     * Splits the invoice into receipt value, variance and expense per line (company currency) and
     * stores the amounts on the lines (the invoice is still a draft here).
     *
     * @param  Collection<int, PurchaseInvoiceLine>  $lines
     */
    public function allocate(PurchaseInvoice $invoice, Collection $lines): void
    {
        $vatLocal = BigDecimal::zero()->toScale(2);

        foreach ($this->taxGroups($lines) as $tax) {
            $vatLocal = $vatLocal->plus(RoundingPolicy::currency($tax['tax']->multipliedBy($invoice->fx_rate)));
        }

        $net = $invoice->total_local->toScale(2)->minus($vatLocal);
        $weights = array_values($lines->map(static fn (PurchaseInvoiceLine $l): BigDecimal => $l->net_amount)->all());
        $sum = array_reduce($weights, static fn (BigDecimal $c, BigDecimal $w): BigDecimal => $c->plus($w), BigDecimal::zero());
        $parts = $weights === [] ? [] : ($sum->isZero() ? [$net, ...array_fill(0, count($weights) - 1, BigDecimal::zero()->toScale(2))] : RoundingPolicy::allocate($net, $weights));
        $consumed = [];

        foreach (array_values($lines->all()) as $n => $line) {
            /** @var PurchaseInvoiceLine $line */
            $lineNet = $parts[$n] ?? BigDecimal::zero()->toScale(2);
            $grni = $this->receiptValue($invoice, $line, $consumed);
            $line->setAttribute('net_local', (string) $lineNet->toScale(4));

            if ($grni === null) {
                $line->setAttribute('grni_amount', '0');
                $line->setAttribute('variance_amount', '0');
                $line->setAttribute('expense_amount', (string) $lineNet->toScale(4));
            } else {
                $line->setAttribute('grni_amount', (string) $grni);
                $line->setAttribute('variance_amount', (string) $lineNet->toScale(4)->minus($grni));
                $line->setAttribute('expense_amount', '0');
            }

            $line->save();
        }
    }

    /**
     * @param  Collection<int, PurchaseInvoiceLine>  $lines  allocated lines
     */
    public function post(PurchaseInvoice $invoice, Collection $lines, ?string $actor): PostedEntry
    {
        $debitNote = $invoice->isDebitNote();
        $description = Messages::get($debitNote ? 'journal_debit_note' : 'journal_invoice', [
            'number' => (string) $invoice->number, 'party' => $invoice->party_name, 'supplier_no' => (string) $invoice->supplier_invoice_no,
        ]);
        $dimensions = ['costCenterId' => $invoice->cost_center_id, 'projectId' => $invoice->project_id, 'documentRef' => $invoice->number, 'description' => $description];
        $sides = [];
        $add = static function (string $accountId, BigDecimal $amount, bool $debit) use (&$sides): void {
            $key = $accountId;
            $sides[$key] = ($sides[$key] ?? BigDecimal::zero())->plus($debit ? $amount : $amount->negated());
        };
        $categories = [];
        $receiptWarehouses = $this->receiptWarehouses($lines);

        foreach ($lines as $line) {
            $categories[$line->item_id] ??= $this->items->find($line->item_id)?->categoryId;
            $context = array_filter([
                'item_category' => $categories[$line->item_id], 'item_id' => $line->item_id, 'party_id' => $invoice->party_id,
                'currency' => $invoice->currency_code, 'tax_code' => $line->tax_code_id, 'warehouse_id' => $line->warehouse_id ?? $invoice->warehouse_id,
            ], static fn (?string $v): bool => $v !== null);
            // The accrual account is resolved like the stock posting did (item, category, warehouse).
            $grniContext = array_filter([
                'item_id' => $line->item_id, 'item_category' => $categories[$line->item_id],
                // Debit notes carry the warehouse the returned goods were shipped from.
                'warehouse_id' => ($debitNote ? $line->warehouse_id : null) ?? $receiptWarehouses[$line->id] ?? $invoice->warehouse_id,
            ], static fn (?string $v): bool => $v !== null);

            if (! $line->grni_amount->isZero()) {
                $add($this->accounts->resolve(ReceiptService::GRNI_EVENT, $grniContext)->id, $line->grni_amount, ! $debitNote);
            }

            if (! $line->variance_amount->isZero()) {
                $add($this->accounts->resolve('purchase.price_variance', $context)->id, $line->variance_amount, ! $debitNote);
            }

            if (! $line->expense_amount->isZero()) {
                $add($this->accounts->resolve('purchase.expense', $context)->id, $line->expense_amount, ! $debitNote);
            }
        }

        $postingLines = [];

        foreach ($sides as $accountId => $amount) {
            if ($amount->isZero()) {
                continue;
            }

            $value = (string) $amount->abs()->toScale(4);
            $postingLines[] = $amount->isPositive() ? PostingLine::debit($accountId, $value, $dimensions) : PostingLine::credit($accountId, $value, $dimensions);
        }

        $vatLocal = BigDecimal::zero()->toScale(2);

        foreach ($this->taxGroups($lines) as $taxCode => $tax) {
            $local = RoundingPolicy::currency($tax['tax']->multipliedBy($invoice->fx_rate));

            if ($local->isZero()) {
                continue;
            }

            $vatLocal = $vatLocal->plus($local);
            $account = $this->accounts->resolve('purchase.vat_input', array_filter(['tax_code' => $taxCode === '' ? null : $taxCode, 'currency' => $invoice->currency_code]));
            $extra = ['description' => $description.' %'.$tax['rate'], 'documentRef' => $invoice->number];
            $postingLines[] = $debitNote ? PostingLine::credit($account->id, (string) $local, $extra) : PostingLine::debit($account->id, (string) $local, $extra);
        }

        $withholding = $invoice->withholding_total_local->toScale(2);
        $payable = $invoice->total_local->toScale(2)->minus($withholding);
        $foreign = $invoice->currency_code !== $this->settings->baseCurrency();
        $payableAccount = $this->accounts->resolve('purchase.payable', array_filter(['party_id' => $invoice->party_id, 'currency' => $invoice->currency_code]));
        $payableExtra = [
            'partyId' => $invoice->party_id,
            'dueDate' => $invoice->due_date?->format('Y-m-d'),
            'description' => $description,
            'documentRef' => $invoice->number,
            'currency' => $foreign ? $invoice->currency_code : null,
            'fxAmount' => $foreign ? (string) $invoice->payable()->toScale(2) : null,
            'fxRate' => $foreign ? (string) $invoice->fx_rate : null,
        ];

        if ($payable->isPositive()) {
            $postingLines[] = $debitNote ? PostingLine::debit($payableAccount->id, (string) $payable, $payableExtra) : PostingLine::credit($payableAccount->id, (string) $payable, $payableExtra);
        }

        if ($withholding->isPositive()) {
            $account = $this->accounts->resolve('purchase.vat_withholding', array_filter(['party_id' => $invoice->party_id, 'currency' => $invoice->currency_code]));
            $extra = ['description' => $description, 'documentRef' => $invoice->number];
            $postingLines[] = $debitNote ? PostingLine::debit($account->id, (string) $withholding, $extra) : PostingLine::credit($account->id, (string) $withholding, $extra);
        }

        return $this->posting->post(new PostingRequest(
            $invoice->company_id,
            new DateTimeImmutable($invoice->document_date->format('Y-m-d')),
            EntryType::General,
            $description,
            self::SOURCE_TYPE,
            $invoice->id,
            $postingLines,
            'main',
            $actor,
        ));
    }

    /**
     * Receipt value cleared by a line (null for lines without received goods). Purchase invoices:
     * the line's share of its receipt line cost, or what is left of it when the line completes the
     * receipt line; debit notes: the receipt value stored on the return line they credit.
     *
     * @param  array<string, array{qty: BigDecimal, value: BigDecimal}>  $consumed  per receipt line, within this invoice
     */
    private function receiptValue(PurchaseInvoice $invoice, PurchaseInvoiceLine $line, array &$consumed): ?BigDecimal
    {
        if ($invoice->isDebitNote()) {
            $return = $line->source_line_id === null ? null : PurchaseReturnLine::query()->whereKey($line->source_line_id)->first();

            return $return?->receipt_cost?->toScale(4);
        }

        if ($line->receipt_line_id === null) {
            return null;
        }

        $receiptLine = PurchaseReceiptLine::query()->whereKey($line->receipt_line_id)->firstOrFail();
        $cost = ($receiptLine->cost_total ?? BigDecimal::zero())->toScale(4);
        $booked = DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
            ->where('l.receipt_line_id', $receiptLine->id)->where('i.invoice_type', 'purchase')->whereIn('i.status', InvoiceStatus::booked())
            ->where('i.id', '<>', $invoice->id)
            ->selectRaw('coalesce(sum(l.quantity), 0) AS qty, coalesce(sum(l.grni_amount), 0) AS value')->first();
        $returned = DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
            ->where('l.receipt_line_id', $receiptLine->id)->whereNull('l.invoice_line_id')->whereIn('r.status', ['shipped', 'debited'])
            ->selectRaw('coalesce(sum(l.quantity), 0) AS qty, coalesce(sum(l.receipt_cost), 0) AS value')->first();
        $here = $consumed[$receiptLine->id] ?? ['qty' => BigDecimal::zero(), 'value' => BigDecimal::zero()];
        $usedQty = Purchasing::dec((string) ($booked->qty ?? '0'))->plus((string) ($returned->qty ?? '0'))->plus($here['qty']);
        $usedValue = Purchasing::dec((string) ($booked->value ?? '0'))->plus((string) ($returned->value ?? '0'))->plus($here['value']);
        $left = $cost->minus($usedValue);
        $left = $left->isNegative() ? BigDecimal::zero()->toScale(4) : $left;

        if ($usedQty->plus($line->quantity)->isGreaterThanOrEqualTo($receiptLine->quantity)) {
            $value = $left;
        } else {
            $value = Purchasing::min($cost->multipliedBy($line->quantity)->dividedBy($receiptLine->quantity, 4, RoundingMode::HalfUp), $left);
        }

        $consumed[$receiptLine->id] = ['qty' => $here['qty']->plus($line->quantity), 'value' => $here['value']->plus($value)];

        return $value->toScale(4);
    }

    /**
     * Warehouse of the receipt each received line came from (the stock posting's context).
     *
     * @param  Collection<int, PurchaseInvoiceLine>  $lines
     * @return array<string, string>
     */
    private function receiptWarehouses(Collection $lines): array
    {
        $receiptLineIds = $lines->pluck('receipt_line_id')->filter()->values()->all();

        if ($receiptLineIds === []) {
            return [];
        }

        $receipts = PurchaseReceiptLine::query()->whereIn('id', $receiptLineIds)->pluck('document_id', 'id')->all();
        $warehouses = PurchaseReceipt::query()->whereIn('id', array_values($receipts))->pluck('warehouse_id', 'id')->all();
        $out = [];

        foreach ($lines as $line) {
            $receipt = $line->receipt_line_id === null ? null : ($receipts[$line->receipt_line_id] ?? null);
            $warehouse = $receipt === null ? null : ($warehouses[$receipt] ?? null);

            if (is_string($warehouse)) {
                $out[$line->id] = $warehouse;
            }
        }

        return $out;
    }

    /**
     * @param  Collection<int, PurchaseInvoiceLine>  $lines
     * @return array<string, array{tax: BigDecimal, rate: string}>
     */
    private function taxGroups(Collection $lines): array
    {
        $taxes = [];

        foreach ($lines as $line) {
            $key = $line->tax_code_id ?? '';
            $taxes[$key] ??= ['tax' => BigDecimal::zero(), 'rate' => (string) $line->tax_rate];
            $taxes[$key]['tax'] = $taxes[$key]['tax']->plus($line->tax_amount);
        }

        return $taxes;
    }
}
