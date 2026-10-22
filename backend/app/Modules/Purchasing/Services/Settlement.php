<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Purchasing\Contracts\PayableSettlement;
use App\Modules\Purchasing\Data\SettlementData;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Models\PayableApplication;
use App\Modules\Purchasing\Models\PurchaseInvoice;
use App\Modules\Purchasing\Services\Machines\InvoiceMachine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use Illuminate\Support\Str;

/**
 * paid_amount / balance_due maintenance under the invoice row lock. Each reference is applied once
 * per invoice: a repeat with the same amount returns the first result, another amount is refused.
 * The balance is the payable (total less withheld VAT) minus what was paid.
 */
final class Settlement implements PayableSettlement
{
    public function __construct(private readonly InvoiceMachine $machine) {}

    public function apply(string $companyId, string $invoiceId, string $amount, string $reference): SettlementData
    {
        return app(CompanyContext::class)->runAs($companyId, fn (): SettlementData => Purchasing::transaction(function () use ($invoiceId, $amount, $reference): SettlementData {
            $invoice = $this->lockInvoice($invoiceId);
            $reference = $this->reference($reference);
            $value = $this->amount($amount);
            $existing = PayableApplication::query()->where('invoice_id', $invoice->id)->where('reference', $reference)->first();

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

            $application = new PayableApplication(['invoice_id' => $invoice->id, 'reference' => $reference, 'amount' => (string) $value, 'applied_at' => now()]);
            $application->save();
            $this->rebalance($invoice, $invoice->paid_amount->plus($value));

            return $this->result($invoice, $application, false);
        }));
    }

    public function unapply(string $companyId, string $invoiceId, string $reference): SettlementData
    {
        return app(CompanyContext::class)->runAs($companyId, fn (): SettlementData => Purchasing::transaction(function () use ($invoiceId, $reference): SettlementData {
            $invoice = $this->lockInvoice($invoiceId);
            $reference = $this->reference($reference);
            $application = PayableApplication::query()->where('invoice_id', $invoice->id)->where('reference', $reference)->first();

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

    private function rebalance(PurchaseInvoice $invoice, BigDecimal $paid): void
    {
        $balance = $invoice->payable()->minus($paid);
        $target = match (true) {
            $balance->isZero() => InvoiceStatus::Paid,
            $paid->isZero() => InvoiceStatus::Booked,
            default => InvoiceStatus::PartiallyPaid,
        };
        // Strings, and no reads of these casts before saving (the state machine reloads the row).
        $invoice->setAttribute('paid_amount', (string) $paid);
        $invoice->setAttribute('balance_due', (string) $balance);

        if ($target === $invoice->status) {
            $invoice->save();

            return;
        }

        $this->machine->transition($invoice, $target);
    }

    private function result(PurchaseInvoice $invoice, PayableApplication $application, bool $replayed): SettlementData
    {
        return new SettlementData($invoice->id, $application->reference, (string) $application->amount, (string) $invoice->paid_amount,
            (string) $invoice->balance_due, $invoice->status->value, $replayed);
    }

    private function lockInvoice(string $invoiceId): PurchaseInvoice
    {
        $invoice = PurchaseInvoice::query()->whereKey(Str::isUuid($invoiceId) ? $invoiceId : null)->lockForUpdate()->first();

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
