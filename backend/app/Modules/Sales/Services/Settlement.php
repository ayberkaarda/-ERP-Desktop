<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Sales\Contracts\ReceivableSettlement;
use App\Modules\Sales\Data\SettlementData;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Models\ReceivableApplication;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Services\Machines\InvoiceMachine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use Illuminate\Support\Str;

/**
 * paid_amount / balance_due maintenance under the invoice row lock. Each reference is applied once
 * per invoice: a repeat with the same amount returns the first result, another amount is refused.
 */
final class Settlement implements ReceivableSettlement
{
    public function __construct(
        private readonly CompanyContext $company,
        private readonly InvoiceMachine $machine,
    ) {}

    public function apply(string $companyId, string $invoiceId, string $amount, string $reference): SettlementData
    {
        return $this->company->runAs($companyId, fn (): SettlementData => Sales::transaction(function () use ($invoiceId, $amount, $reference): SettlementData {
            $invoice = $this->lockInvoice($invoiceId);
            $reference = $this->reference($reference);
            $value = $this->amount($amount);
            $existing = ReceivableApplication::query()->where('invoice_id', $invoice->id)->where('reference', $reference)->first();

            if ($existing !== null) {
                if (! $existing->amount->isEqualTo($value) || $existing->unapplied_at !== null) {
                    Messages::fail('reference', 'settlement_reference_used');
                }

                return $this->result($invoice, $existing, true);
            }

            if (! in_array($invoice->status->value, InvoiceStatus::open(), true)) {
                Messages::fail('invoice', 'invoice_not_open');
            }

            if ($value->isGreaterThan($invoice->balance_due)) {
                Messages::fail('amount', 'settlement_exceeds_balance', ['balance' => (string) $invoice->balance_due]);
            }

            $application = new ReceivableApplication(['invoice_id' => $invoice->id, 'reference' => $reference, 'amount' => (string) $value, 'applied_at' => now()]);
            $application->save();
            $this->rebalance($invoice, $invoice->paid_amount->plus($value));

            return $this->result($invoice, $application, false);
        }));
    }

    public function unapply(string $companyId, string $invoiceId, string $reference): SettlementData
    {
        return $this->company->runAs($companyId, fn (): SettlementData => Sales::transaction(function () use ($invoiceId, $reference): SettlementData {
            $invoice = $this->lockInvoice($invoiceId);
            $reference = $this->reference($reference);
            $application = ReceivableApplication::query()->where('invoice_id', $invoice->id)->where('reference', $reference)->first();

            if ($application === null) {
                Messages::fail('reference', 'settlement_unknown');
            }

            if ($application->unapplied_at !== null) {
                return $this->result($invoice, $application, true);
            }

            $application->unapplied_at = now();
            $application->save();
            $this->rebalance($invoice, $invoice->paid_amount->minus($application->amount));

            return $this->result($invoice, $application, false);
        }));
    }

    private function rebalance(SalesInvoice $invoice, BigDecimal $paid): void
    {
        $balance = $invoice->total->minus($paid);
        $target = match (true) {
            $balance->isZero() => InvoiceStatus::Paid,
            $paid->isZero() => InvoiceStatus::Issued,
            default => InvoiceStatus::PartiallyPaid,
        };
        // Strings, and no reads of these casts before saving: a cached cast object would be
        // merged into the original values by the state machine's reload and the change lost.
        $invoice->setAttribute('paid_amount', (string) $paid);
        $invoice->setAttribute('balance_due', (string) $balance);

        if ($target === $invoice->status) {
            $invoice->save();

            return;
        }

        $this->machine->transition($invoice, $target);
    }

    private function result(SalesInvoice $invoice, ReceivableApplication $application, bool $replayed): SettlementData
    {
        return new SettlementData($invoice->id, $application->reference, (string) $application->amount, (string) $invoice->paid_amount,
            (string) $invoice->balance_due, $invoice->status->value, $replayed);
    }

    private function lockInvoice(string $invoiceId): SalesInvoice
    {
        $invoice = SalesInvoice::query()->whereKey(Str::isUuid($invoiceId) ? $invoiceId : null)->lockForUpdate()->first();

        if ($invoice === null) {
            Messages::fail('invoice_id', 'invoice_unknown');
        }

        return $invoice;
    }

    private function reference(string $reference): string
    {
        $reference = trim($reference);

        if ($reference === '' || mb_strlen($reference) > 100) {
            Messages::fail('reference', 'settlement_reference_invalid');
        }

        return $reference;
    }

    private function amount(string $amount): BigDecimal
    {
        try {
            $value = BigDecimal::of($amount);
        } catch (MathException) {
            Messages::fail('amount', 'settlement_amount_invalid');
        }

        if (! $value->isPositive() || $value->getScale() > 4) {
            Messages::fail('amount', 'settlement_amount_invalid');
        }

        return $value->toScale(4);
    }
}
