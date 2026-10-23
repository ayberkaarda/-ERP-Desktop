<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Company\CompanyContext;
use App\Core\Money\RoundingPolicy;
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
use Brick\Math\RoundingMode;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * paid_amount / balance_due maintenance under the invoice row lock. Each reference is applied once
 * per invoice: a repeat with the same amount returns the first result, another amount is refused.
 */
final class Settlement implements ReceivableSettlement
{
    public function __construct(private readonly InvoiceMachine $machine) {}

    public function apply(string $companyId, string $invoiceId, string $amount, string $reference, ?string $effectiveDate = null, ?string $localAmount = null): SettlementData
    {
        return app(CompanyContext::class)->runAs($companyId, fn (): SettlementData => Sales::transaction(function () use ($invoiceId, $amount, $reference, $effectiveDate, $localAmount): SettlementData {
            $invoice = $this->lockInvoice($invoiceId);
            $reference = $this->reference($reference);
            $value = $this->amount($amount);
            $date = $this->effectiveDate($effectiveDate, $invoice->document_date->format('Y-m-d'));
            $existing = ReceivableApplication::query()->where('invoice_id', $invoice->id)->where('reference', $reference)->first();

            if ($existing !== null) {
                if (! $existing->amount->isEqualTo($value) || $existing->unapplied_at !== null || ($effectiveDate !== null && $existing->getAttribute('effective_date') !== $effectiveDate) || ($localAmount !== null && $existing->getAttribute('local_amount') !== null && ! BigDecimal::of((string) $existing->getAttribute('local_amount'))->isEqualTo($localAmount))) {
                    Messages::fail('reference', 'settlement_reference_used');
                }

                return $this->result($invoice, $existing, true);
            }

            $this->assertTimeline($invoice, $date);
            if (! in_array($invoice->status->value, InvoiceStatus::open(), true)) {
                Messages::fail('invoice', 'invoice_not_open');
            }

            if ($value->isGreaterThan($invoice->balance_due)) {
                Messages::fail('amount', 'settlement_exceeds_balance', ['balance' => (string) $invoice->balance_due]);
            }

            $carrying = $this->localFor($invoice, $value);
            if ($localAmount !== null && ! $carrying->isEqualTo($localAmount)) {
                throw ValidationException::withMessages(['local_amount' => ['The carrying amount changed; reload the invoice.']]);
            }
            $application = new ReceivableApplication(['local_amount' => (string) $carrying, 'invoice_id' => $invoice->id, 'reference' => $reference, 'amount' => (string) $value, 'applied_at' => now(), 'effective_date' => $date]);
            $application->save();
            $this->rebalance($invoice, $invoice->paid_amount->plus($value));

            return $this->result($invoice, $application, false);
        }));
    }

    public function unapply(string $companyId, string $invoiceId, string $reference, ?string $effectiveDate = null): SettlementData
    {
        return app(CompanyContext::class)->runAs($companyId, fn (): SettlementData => Sales::transaction(function () use ($invoiceId, $reference, $effectiveDate): SettlementData {
            $invoice = $this->lockInvoice($invoiceId);
            $reference = $this->reference($reference);
            $application = ReceivableApplication::query()->where('invoice_id', $invoice->id)->where('reference', $reference)->first();

            if ($application === null) {
                Messages::fail('reference', 'settlement_unknown');
            }

            if ($application->unapplied_at !== null) {
                return $this->result($invoice, $application, true);
            }

            $date = $this->effectiveDate($effectiveDate, (string) ($application->getAttribute('effective_date') ?? $application->applied_at->format('Y-m-d')));
            $this->assertTimeline($invoice, $date);
            $application->setAttribute('unapplied_effective_date', $date);
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

    private function effectiveDate(?string $date, string $minimum): string
    {
        $date ??= now()->toDateString();
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($parsed === false || $parsed->format('Y-m-d') !== $date || $date < $minimum) {
            throw ValidationException::withMessages(['effective_date' => [__('validation.date', ['attribute' => 'effective_date'])]]);
        }

        return $date;
    }

    private function localFor(SalesInvoice $invoice, BigDecimal $amount): BigDecimal
    {
        $total = $invoice->total;
        $local = $invoice->total_local;
        $settled = BigDecimal::zero();
        foreach (ReceivableApplication::query()->where('invoice_id', $invoice->id)->whereNull('unapplied_at')->get() as $application) {
            $stored = $application->getAttribute('local_amount');
            $settled = $settled->plus($stored === null ? RoundingPolicy::currency($local->multipliedBy($application->amount)->dividedBy($total, 8, RoundingMode::HalfUp)) : (string) $stored);
        }
        $remaining = $local->minus($settled);

        return ($amount->isEqualTo($invoice->balance_due) ? $remaining : RoundingPolicy::currency($remaining->multipliedBy($amount)->dividedBy($invoice->balance_due, 8, RoundingMode::HalfUp)))->toScale(4);
    }

    private function assertTimeline(SalesInvoice $invoice, string $date): void
    {
        $last = ReceivableApplication::query()->where('invoice_id', $invoice->id)->selectRaw('max(greatest(coalesce(effective_date,applied_at::date),coalesce(unapplied_effective_date,unapplied_at::date)))::text AS last_date')->value('last_date');
        if (is_string($last) && $date < $last) {
            throw ValidationException::withMessages(['effective_date' => [__('sales::messages.settlement_date_order')]]);
        }
    }
}
