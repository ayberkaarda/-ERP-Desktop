<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Accounting\Contracts\PeriodGuard;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Sales\Enums\DeliveryStatus;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Enums\InvoiceType;
use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Enums\ReturnStatus;
use App\Modules\Sales\Events\SalesInvoiceIssued;
use App\Modules\Sales\Events\SalesInvoiceReversed;
use App\Modules\Sales\Models\SalesDelivery;
use App\Modules\Sales\Models\SalesDeliveryLine;
use App\Modules\Sales\Models\SalesInvoice;
use App\Modules\Sales\Models\SalesInvoiceLine;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesOrderLine;
use App\Modules\Sales\Models\SalesReturn;
use App\Modules\Sales\Services\Composer\Composed;
use App\Modules\Sales\Services\Composer\DocumentComposer;
use App\Modules\Sales\Services\Machines\InvoiceMachine;
use App\Modules\Sales\Services\Machines\ReturnMachine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use App\Modules\Sales\Support\SalesSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Invoices and credit notes. Lines reference delivery lines (bounded by what was delivered and not
 * yet invoiced), order lines (services, or stock goods with deliver_on_invoice, which posts a
 * delivery at issue) or nothing (direct services / deliver_on_invoice goods). Sources are locked
 * in a fixed order (orders, deliveries, then the invoice) so concurrent conversions serialize.
 * Issue assigns the gapless number and books the journal in one transaction; issued invoices are
 * corrected only by reverse or a return.
 */
final class InvoiceService extends DocumentService
{
    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly InvoiceMachine $machine,
        private readonly ReturnMachine $returns,
        private readonly InvoiceJournal $journal,
        private readonly PostingService $posting,
        private readonly PeriodGuard $periods,
        private readonly CreditControl $credit,
        private readonly OrderProgress $progress,
        private readonly Quantities $quantities,
        private readonly DeliveryService $deliveries,
        private readonly SalesSettings $settings,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines  direct lines and/or lines with delivery_line_id / order_line_id
     */
    public function create(array $data, array $lines, ?Authenticatable $actor, bool $canOverridePrice): SalesInvoice
    {
        return Sales::transaction(function () use ($data, $lines, $actor, $canOverridePrice): SalesInvoice {
            $deliver = (bool) ($data['deliver_on_invoice'] ?? false);
            $this->lockSources($lines);
            [$inputs, $extras, $currencies] = $this->sourceLines($lines, $deliver, null, (string) ($data['party_id'] ?? ''));
            $composed = $this->compose($data, $inputs, $canOverridePrice);
            $this->assertCurrencies($currencies, (string) $composed->header['currency_code']);
            $this->assertDeliverable($composed->lines, $extras, $deliver);
            $invoice = $this->store->create(new SalesInvoice, $composed, $this->headerExtras($data, $extras), $extras, self::actorId($actor));
            $this->logOverrides($invoice, $composed, $actor);

            return $invoice;
        });
    }

    /**
     * Invoice of a posted delivery: the given lines (delivery_line_id, quantity) or all that is not yet invoiced.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function createFromDelivery(SalesDelivery $delivery, array $data, ?array $lines, ?Authenticatable $actor): SalesInvoice
    {
        return Sales::transaction(function () use ($delivery, $data, $lines, $actor): SalesInvoice {
            if ($delivery->order_id !== null) {
                $this->lockOrders([$delivery->order_id]);
            }

            $delivery = $this->lock($delivery);

            if ($delivery->status !== DeliveryStatus::Posted) {
                Messages::fail('delivery', 'delivery_not_posted');
            }

            if ($lines === null) {
                $lines = [];

                foreach ($delivery->lines()->get() as $line) {
                    $remaining = $line->quantity->minus($this->quantities->invoicedOnDelivery($line->id));

                    if ($remaining->isPositive()) {
                        $lines[] = ['delivery_line_id' => $line->id, 'quantity' => (string) $remaining];
                    }
                }
            } else {
                $ids = $delivery->lines()->pluck('id')->all();

                foreach ($lines as $i => $line) {
                    if (! in_array($line['delivery_line_id'] ?? null, $ids, true)) {
                        Messages::fail("lines.{$i}.delivery_line_id", 'source_line_unknown');
                    }
                }
            }

            if ($lines === []) {
                Messages::fail('lines', 'nothing_to_invoice');
            }

            [$inputs, $extras] = $this->sourceLines($lines, false, null, $delivery->party_id);
            $header = $this->convertedHeader($delivery, $data);
            $composed = $this->compose($header, $inputs, true);

            return $this->store->create(new SalesInvoice, $composed, [
                'delivery_id' => $delivery->id, 'order_id' => $delivery->order_id, 'source_type' => 'sales_delivery', 'source_id' => $delivery->id,
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * Invoice of an order: lines (order_line_id, quantity) or everything invoiceable. Stock lines are
     * taken from posted, not yet invoiced delivery lines of the order unless deliver_on_invoice.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function createFromOrder(SalesOrder $order, array $data, ?array $lines, ?Authenticatable $actor): SalesInvoice
    {
        return Sales::transaction(function () use ($order, $data, $lines, $actor): SalesInvoice {
            $deliver = (bool) ($data['deliver_on_invoice'] ?? false);
            $order = $this->lockOrders([$order->id])[$order->id];

            if (! in_array($order->status, OrderStatus::open(), true)) {
                Messages::fail('order', 'order_not_open');
            }

            $orderLines = $order->lines()->get()->keyBy('id');
            $picked = [];

            if ($lines === null) {
                foreach ($orderLines as $line) {
                    $picked[] = ['order_line_id' => $line->id, 'quantity' => null];
                }
            } else {
                foreach ($lines as $i => $line) {
                    if (! $orderLines->has((string) ($line['order_line_id'] ?? ''))) {
                        Messages::fail("lines.{$i}.order_line_id", 'source_line_unknown');
                    }

                    $picked[] = ['order_line_id' => (string) $line['order_line_id'], 'quantity' => (string) $line['quantity'], 'index' => $i];
                }
            }

            $resolved = [];

            foreach ($picked as $pick) {
                /** @var SalesOrderLine $orderLine */
                $orderLine = $orderLines->get($pick['order_line_id']);
                array_push($resolved, ...$this->allocateOrderLine($orderLine, $pick['quantity'], $deliver, isset($pick['index']) ? "lines.{$pick['index']}.quantity" : 'lines'));
            }

            if ($resolved === []) {
                Messages::fail('lines', 'nothing_to_invoice');
            }

            $this->lockSources($resolved);
            [$inputs, $extras] = $this->sourceLines($resolved, $deliver, null, $order->party_id);
            $composed = $this->compose($this->convertedHeader($order, $data), $inputs, true);

            return $this->store->create(new SalesInvoice, $composed, [
                'order_id' => $order->id, 'source_type' => 'sales_order', 'source_id' => $order->id, 'deliver_on_invoice' => $deliver,
            ], $extras, self::actorId($actor));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(SalesInvoice $invoice, array $data, ?array $lines, int $version, ?Authenticatable $actor, bool $canOverridePrice): SalesInvoice
    {
        return Sales::transaction(function () use ($invoice, $data, $lines, $version, $actor, $canOverridePrice): SalesInvoice {
            $lines ??= $this->linesAsInput($invoice);
            $this->lockSources($lines);
            $invoice = $this->lock($invoice, $version);
            $this->assertDraft($invoice);

            if ($invoice->isCreditNote()) {
                Messages::fail('document', 'credit_note_not_editable');
            }

            $deliver = array_key_exists('deliver_on_invoice', $data) ? (bool) $data['deliver_on_invoice'] : $invoice->deliver_on_invoice;
            $header = $this->mergedHeader($invoice, $data);
            [$inputs, $extras, $currencies] = $this->sourceLines($lines, $deliver, $invoice->id, (string) $header['party_id']);
            $composed = $this->compose($header, $inputs, $canOverridePrice);
            $this->assertCurrencies($currencies, (string) $composed->header['currency_code']);
            $this->assertDeliverable($composed->lines, $extras, $deliver);
            $this->store->replace($invoice, $composed, ['deliver_on_invoice' => $deliver], $extras);
            $this->logOverrides($invoice, $composed, $actor);

            return $invoice;
        });
    }

    public function delete(SalesInvoice $invoice, ?int $version): void
    {
        Sales::transaction(function () use ($invoice, $version): void {
            $invoice = $this->lock($invoice, $version);
            $this->assertDraft($invoice);
            $invoice->delete();
        });
    }

    public function cancel(SalesInvoice $invoice, ?int $version, ?Authenticatable $actor): SalesInvoice
    {
        return Sales::transaction(function () use ($invoice, $version, $actor): SalesInvoice {
            $invoice = $this->lock($invoice, $version);
            $this->assertStatus($invoice, [InvoiceStatus::Draft, InvoiceStatus::PendingApproval], InvoiceStatus::Cancelled->value);

            return $this->machine->transition($invoice, InvoiceStatus::Cancelled, $actor);
        });
    }

    /**
     * Issues once: number, credit check (sales), automatic delivery of deliver_on_invoice goods,
     * journal and order progress in one transaction. An issued invoice is returned unchanged.
     *
     * @return array{0: SalesInvoice, 1: bool, 2: list<array<string, mixed>>} invoice, replayed, warnings
     */
    public function issue(SalesInvoice $invoice, ?int $version, ?string $overrideReason, bool $canOverride, ?Authenticatable $actor): array
    {
        return Sales::transaction(function () use ($invoice, $version, $overrideReason, $canOverride, $actor): array {
            [$invoice, $orders] = $this->lockWithSources($invoice);

            if (in_array($invoice->status->value, InvoiceStatus::booked(), true) || $invoice->status === InvoiceStatus::Reversed) {
                return [$invoice, true, []];
            }

            if ($version !== null) {
                $invoice->assertVersion($version);
            }

            $this->assertStatus($invoice, [InvoiceStatus::Draft], InvoiceStatus::Issued->value);

            return $this->issueLocked($invoice, $orders, $overrideReason, $canOverride, $actor);
        });
    }

    /**
     * Reverses the journal entry (and with $reverseStock the deliveries this invoice alone covers).
     *
     * @return array{0: SalesInvoice, 1: bool}
     */
    public function reverse(SalesInvoice $invoice, ?int $version, string $date, string $reason, bool $reverseStock, ?Authenticatable $actor): array
    {
        return Sales::transaction(function () use ($invoice, $version, $date, $reason, $reverseStock, $actor): array {
            [$invoice, $orders] = $this->lockWithSources($invoice);

            if ($invoice->status === InvoiceStatus::Reversed) {
                return [$invoice, true];
            }

            if ($version !== null) {
                $invoice->assertVersion($version);
            }

            $this->assertStatus($invoice, [InvoiceStatus::Issued], InvoiceStatus::Reversed->value);
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

            $lines = $invoice->lines()->get();

            if (! $invoice->isCreditNote() && DB::table('sales_returns')->where('invoice_id', $invoice->id)->where('status', '<>', ReturnStatus::Cancelled->value)->exists()) {
                Messages::fail('document', 'invoice_has_returns');
            }

            $entry = $this->posting->reverse((string) $invoice->journal_entry_id, new DateTimeImmutable($date), $reason);
            $stockReversed = $reverseStock && $this->reverseDeliveries($invoice, $lines, $date, $reason, $actor);
            $this->applyToOrders($lines, $orders, -1, $actor);

            if ($invoice->return_id !== null) {
                $return = SalesReturn::query()->whereKey($invoice->return_id)->lockForUpdate()->first();

                if ($return !== null && $return->status === ReturnStatus::Credited) {
                    $return->credit_invoice_id = null;
                    $return->credited_at = null;
                    $this->returns->transition($return, ReturnStatus::Received, $actor);
                }
            }

            $invoice->setAttribute('balance_due', '0');
            $invoice->reversed_at = now();
            $invoice->reversed_by = self::actorId($actor);
            $invoice->reversal_date = Carbon::parse($date);
            $invoice->reversal_reason = $reason;
            $invoice->reversal_journal_entry_id = $entry->id;
            $this->machine->transition($invoice, InvoiceStatus::Reversed, $actor);
            event(new SalesInvoiceReversed($invoice->company_id, $invoice->id, (string) $invoice->number, $entry->id, $stockReversed));

            return [$invoice, false];
        });
    }

    /**
     * Credit note of a received return, issued at once (rate and prices of the original invoice).
     */
    public function creditReturn(SalesReturn $return, SalesInvoice $original, ?Authenticatable $actor): SalesInvoice
    {
        $inputs = [];
        $extras = [];
        $originalLines = $original->lines()->get()->keyBy('id');

        foreach ($return->lines()->get() as $line) {
            /** @var SalesInvoiceLine $source */
            $source = $originalLines->get($line->invoice_line_id);
            $inputs[] = [...$this->fixedLine($source, (string) $line->quantity, true), 'source_line_id' => $line->id];
            $extras[] = ['original_line_id' => $source->id];
        }

        $header = $this->mergedHeader($original, ['document_date' => $return->document_date->format('Y-m-d')]);
        $header['fx_rate'] = (string) $original->fx_rate;
        $header['due_date'] = $return->document_date->format('Y-m-d');
        $composed = $this->allocateCredit($this->compose($header, $inputs, true), $extras, $originalLines->all(), (string) $original->fx_rate);
        $credit = $this->store->create(new SalesInvoice, $composed, [
            'invoice_type' => InvoiceType::Return->value, 'original_invoice_id' => $original->id, 'return_id' => $return->id,
            'order_id' => $original->order_id, 'source_type' => 'sales_return', 'source_id' => $return->id,
        ], $extras, self::actorId($actor));
        [$credit] = $this->issueLocked($this->lock($credit), [], null, false, $actor);

        return $credit;
    }

    /**
     * Credit notes never give back more than the original line: amounts already credited (credit
     * notes not reversed) are deducted, the credit that completes a line's quantity takes exactly
     * what remains, and partial credits are capped by it. Header totals follow the lines.
     *
     * @param  list<array<string, mixed>>  $extras
     * @param  array<string, SalesInvoiceLine>  $originals
     */
    private function allocateCredit(Composed $composed, array $extras, array $originals, string $fxRate): Composed
    {
        $lines = $composed->lines;

        foreach ($lines as $i => $row) {
            $source = $originals[(string) ($extras[$i]['original_line_id'] ?? '')] ?? null;

            if ($source === null) {
                continue;
            }

            $prev = DB::table('sales_invoice_lines as l')->join('sales_invoices as i', 'i.id', '=', 'l.document_id')
                ->where('l.original_line_id', $source->id)->whereIn('i.status', InvoiceStatus::booked())
                ->selectRaw('coalesce(sum(l.quantity), 0) AS qty, coalesce(sum(l.line_discount), 0) AS discount, coalesce(sum(l.net_amount), 0) AS net, coalesce(sum(l.tax_amount), 0) AS tax')
                ->first();
            $left = [
                'discount' => $source->line_discount->minus((string) ($prev->discount ?? '0')),
                'net' => $source->net_amount->minus((string) ($prev->net ?? '0')),
                'tax' => $source->tax_amount->minus((string) ($prev->tax ?? '0')),
            ];
            $final = Sales::dec((string) ($prev->qty ?? '0'))->plus((string) $row['quantity'])->isGreaterThanOrEqualTo($source->quantity);
            $amounts = [];

            foreach (['discount' => 'line_discount', 'net' => 'net_amount', 'tax' => 'tax_amount'] as $key => $column) {
                $value = Sales::dec((string) $row[$column]);
                $amounts[$key] = $final || $value->isGreaterThan($left[$key]) ? $left[$key] : $value;
                $amounts[$key] = $amounts[$key]->isNegative() ? BigDecimal::zero() : $amounts[$key];
            }

            $lines[$i] = [...$row,
                'line_discount' => Sales::money($amounts['discount']),
                'net_amount' => Sales::money($amounts['net']),
                'tax_amount' => Sales::money($amounts['tax']),
                'gross_amount' => Sales::money($amounts['net']->plus($amounts['discount'])),
                'line_total' => Sales::money($amounts['net']->plus($amounts['tax'])),
            ];
        }

        return new Composed([...$composed->header, ...self::retotal($lines, $fxRate)], $lines, $composed->totals, $composed->warnings, $composed->priceOverrides, $composed->pricing);
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
        $sum = ['gross_amount' => BigDecimal::zero(), 'line_discount' => BigDecimal::zero(), 'tax_amount' => BigDecimal::zero(), 'line_total' => BigDecimal::zero()];
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

        return [
            'subtotal' => Sales::money($sum['gross_amount']), 'discount_total' => Sales::money($sum['line_discount']),
            'tax_total' => Sales::money($sum['tax_amount']), 'total' => Sales::money($sum['line_total']),
            'subtotal_local' => Sales::money($totalLocal->minus($taxLocal)->plus($discountLocal)), 'discount_total_local' => Sales::money($discountLocal),
            'tax_total_local' => Sales::money($taxLocal), 'total_local' => Sales::money($totalLocal),
        ];
    }

    /**
     * @param  array<string, SalesOrder>  $orders
     * @return array{0: SalesInvoice, 1: bool, 2: list<array<string, mixed>>}
     */
    private function issueLocked(SalesInvoice $invoice, array $orders, ?string $overrideReason, bool $canOverride, ?Authenticatable $actor): array
    {
        $lines = $invoice->lines()->get();

        if ($lines->isEmpty()) {
            Messages::fail('lines', 'lines_required');
        }

        if (! $invoice->total->isPositive()) {
            Messages::fail('lines', 'invoice_total_zero');
        }

        $party = $this->composer->party($invoice->party_id);
        $this->periods->assertOpen($invoice->company_id, new DateTimeImmutable($invoice->document_date->format('Y-m-d')));
        $warnings = [];

        if (! $invoice->isCreditNote()) {
            $this->recheckBounds($invoice, $lines);
            $prior = $this->priorOverride($lines, $orders);
            $prior = $prior?->party_id === $invoice->party_id ? $prior : null;
            $check = $this->credit->check($invoice->company_id, $party, (string) $invoice->total_local, null, $this->coveredByOrders($lines, $orders), $overrideReason, $canOverride, priorOverride: $prior === null ? null : ['exposure' => (string) $prior->credit_override_exposure, 'currency' => (string) $prior->credit_override_currency]);

            if ($check !== null && $check->overridden) {
                $own = $overrideReason !== null && trim($overrideReason) !== '' && $canOverride;
                $invoice->credit_override_reason = $own ? $overrideReason : $prior?->credit_override_reason;
                $invoice->credit_override_by = $own ? self::actorId($actor) : $prior?->credit_override_by;
                activity()->performedOn($invoice)->causedBy(self::causer($actor))->withProperties(['reason' => $invoice->credit_override_reason, 'inherited_from' => $own ? null : $prior?->id, 'check' => $check->toArray()])
                    ->event('credit_override')->log('credit_override');
            }

            $warning = CreditControl::warning($check);
            $warnings = $warning === null ? [] : [$warning];
            $this->deliverPending($invoice, $lines, $orders, $actor);
        }

        $this->store->assignNumber($invoice, $invoice->numberKind());
        $entry = $this->journal->post($invoice, $lines, self::actorId($actor));

        if (! $invoice->isCreditNote()) {
            $this->applyToOrders($lines, $orders, 1, $actor);
        }

        $invoice->journal_entry_id = $entry->id;
        $invoice->setAttribute('paid_amount', '0');
        $invoice->setAttribute('balance_due', (string) $invoice->total);
        $invoice->issued_at = now();
        $invoice->issued_by = self::actorId($actor);
        $this->machine->transition($invoice, InvoiceStatus::Issued, $actor);
        event(new SalesInvoiceIssued($invoice->company_id, $invoice->id, (string) $invoice->number, $invoice->invoice_type->value,
            $invoice->party_id, $entry->id, (string) $invoice->total_local));

        return [$invoice, false, $warnings];
    }

    /**
     * Posts a delivery for stock lines without one (deliver_on_invoice), grouped by order.
     *
     * @param  Collection<int, SalesInvoiceLine>  $lines
     * @param  array<string, SalesOrder>  $orders
     */
    private function deliverPending(SalesInvoice $invoice, Collection $lines, array $orders, ?Authenticatable $actor): void
    {
        $groups = [];
        $orderOfLine = $this->orderIdsOfLines($lines);

        foreach ($lines as $line) {
            if ($line->item_type !== 'stock' || $line->delivery_line_id !== null) {
                continue;
            }

            if (! $invoice->deliver_on_invoice) {
                Messages::fail('deliver_on_invoice', 'invoice_requires_delivery');
            }

            $groups[$orderOfLine[$line->id] ?? ''][] = $line;
        }

        foreach ($groups as $orderId => $group) {
            $map = $this->deliveries->deliverForInvoice($invoice, $group, $orderId === '' ? null : ($orders[$orderId] ?? null), $actor);

            foreach ($group as $line) {
                $line->delivery_line_id = $map[$line->id];
                $line->save();
            }
        }
    }

    /**
     * @param  Collection<int, SalesInvoiceLine>  $lines
     * @param  array<string, SalesOrder>  $orders
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

            $orderLine = SalesOrderLine::query()->whereKey($line->order_line_id)->firstOrFail();
            $this->progress->addInvoiced($orderLine, $sign > 0 ? $line->quantity : $line->quantity->negated());
            $touched[$orderId] = $orders[$orderId];
        }

        foreach ($touched as $order) {
            $this->progress->refresh($order, $actor);
        }
    }

    /**
     * The order whose recorded credit override an invoice inherits: every line comes from an open
     * order and all those orders were confirmed over the limit with an override (null otherwise).
     *
     * @param  Collection<int, SalesInvoiceLine>  $lines
     * @param  array<string, SalesOrder>  $orders
     */
    private function priorOverride(Collection $lines, array $orders): ?SalesOrder
    {
        $orderOfLine = $this->orderIdsOfLines($lines);
        $found = null;

        foreach ($lines as $line) {
            $order = $orders[$orderOfLine[$line->id] ?? ''] ?? null;

            if ($order === null || ! self::overrideHolds($order)) {
                return null;
            }

            $found ??= $order;
        }

        return $found;
    }

    /** An order override binds its customer, revision and amount; it lapses when any of them changed. */
    private static function overrideHolds(SalesOrder $order): bool
    {
        return $order->credit_override_reason !== null && $order->credit_override_reason !== ''
            && $order->credit_override_party_id === $order->party_id
            && $order->credit_override_revision === $order->revision
            && $order->credit_override_amount !== null && $order->credit_override_exposure !== null && $order->credit_override_currency !== null
            && ! $order->total_local->isGreaterThan($order->credit_override_amount);
    }

    /**
     * Unlocked read of the open order value a draft sale invoice replaces (credit previews only).
     */
    public function coveredLocal(SalesInvoice $invoice): string
    {
        $lines = $invoice->lines()->get();
        $ids = array_values(array_unique($this->orderIdsOfLines($lines)));
        $orders = $ids === [] ? [] : SalesOrder::query()->whereIn('id', $ids)->get()->keyBy('id')->all();

        return $this->coveredByOrders($lines, $orders);
    }

    /**
     * Open order value the invoice replaces (so it is not counted twice in the credit check), local.
     *
     * @param  Collection<int, SalesInvoiceLine>  $lines
     * @param  array<string, SalesOrder>  $orders
     */
    private function coveredByOrders(Collection $lines, array $orders): string
    {
        $covered = BigDecimal::zero();
        $orderOfLine = $this->orderIdsOfLines($lines);

        foreach ($lines as $line) {
            $order = $orders[$orderOfLine[$line->id] ?? ''] ?? null;

            if ($line->order_line_id === null || $order === null || ! in_array($order->status, OrderStatus::open(), true)) {
                continue;
            }

            $orderLine = SalesOrderLine::query()->whereKey($line->order_line_id)->firstOrFail();
            $open = $orderLine->quantity->minus($orderLine->invoiced_quantity);
            $qty = Sales::min($line->quantity, $open->isNegative() ? BigDecimal::zero() : $open);
            $covered = $covered->plus($orderLine->line_total->multipliedBy($qty)->dividedBy($orderLine->quantity, 8, RoundingMode::HalfUp)->multipliedBy($order->fx_rate));
        }

        return (string) RoundingPolicy::currency($covered);
    }

    /**
     * Delivery and order bounds again at issue, under the same locks.
     *
     * @param  Collection<int, SalesInvoiceLine>  $lines
     */
    private function recheckBounds(SalesInvoice $invoice, Collection $lines): void
    {
        $this->sourceLines($this->linesAsInput($invoice), $invoice->deliver_on_invoice, $invoice->id, $invoice->party_id, recheck: true);
    }

    /**
     * Reverses the deliveries whose lines only this invoice covers (automatic ones included).
     *
     * @param  Collection<int, SalesInvoiceLine>  $lines
     */
    private function reverseDeliveries(SalesInvoice $invoice, Collection $lines, string $date, string $reason, ?Authenticatable $actor): bool
    {
        $deliveryIds = SalesDeliveryLine::query()->whereIn('id', $lines->pluck('delivery_line_id')->filter()->all())->distinct()->pluck('document_id')->all();
        $deliveries = SalesDelivery::query()->whereIn('id', $deliveryIds)->where('status', DeliveryStatus::Posted->value)->orderBy('id')->get();

        foreach ($deliveries as $delivery) {
            foreach ($delivery->lines()->get() as $line) {
                if ($this->quantities->invoicedOnDelivery($line->id, $invoice->id)->isPositive()) {
                    Messages::fail('reverse_stock', 'delivery_invoiced_elsewhere', ['delivery' => (string) $delivery->number]);
                }
            }

            $this->deliveries->cancel($delivery, null, $reason, $date, $actor, fromInvoice: true);
        }

        return $deliveries->isNotEmpty();
    }

    /**
     * Turns invoice line input into composer input plus source columns, enforcing the bounds.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>, 2: array<int, string>}
     */
    private function sourceLines(array $lines, bool $deliver, ?string $exceptInvoiceId, string $partyId, bool $recheck = false): array
    {
        $inputs = [];
        $extras = [];
        $currencies = [];
        $perDelivery = [];
        $perOrder = [];
        $perOrderDirect = [];

        foreach ($lines as $i => $line) {
            $field = "lines.{$i}";
            $qty = Sales::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
            $deliveryLineId = is_string($line['delivery_line_id'] ?? null) ? $line['delivery_line_id'] : null;
            $orderLineId = is_string($line['order_line_id'] ?? null) ? $line['order_line_id'] : null;

            if ($deliveryLineId !== null) {
                $source = SalesDeliveryLine::query()->whereKey($deliveryLineId)->first();
                $delivery = $source === null ? null : SalesDelivery::query()->whereKey($source->document_id)->first();

                if ($source === null || $delivery === null || $delivery->party_id !== $partyId) {
                    Messages::fail("{$field}.delivery_line_id", 'source_line_unknown');
                }

                if ($delivery->status !== DeliveryStatus::Posted) {
                    Messages::fail("{$field}.delivery_line_id", 'delivery_not_posted');
                }

                $perDelivery[$source->id] = ($perDelivery[$source->id] ?? BigDecimal::zero())->plus($qty);
                $invoiced = $this->quantities->invoicedOnDelivery($source->id, $exceptInvoiceId);

                if ($invoiced->plus($perDelivery[$source->id])->isGreaterThan($source->quantity)) {
                    Messages::fail("{$field}.quantity", 'invoice_exceeds_delivered', ['remaining' => Sales::qty($source->quantity->minus($invoiced))]);
                }

                $inputs[] = [...$this->fixedLine($source, (string) $qty), 'source_line_id' => $source->id];
                $extras[] = ['delivery_line_id' => $source->id, 'order_line_id' => $source->order_line_id];
                $currencies[$i] = $delivery->currency_code;

                continue;
            }

            if ($orderLineId !== null) {
                $source = SalesOrderLine::query()->whereKey($orderLineId)->first();
                $order = $source === null ? null : SalesOrder::query()->whereKey($source->document_id)->first();

                if ($source === null || $order === null || $order->party_id !== $partyId) {
                    Messages::fail("{$field}.order_line_id", 'source_line_unknown');
                }

                if (! $recheck && ! in_array($order->status, OrderStatus::open(), true)) {
                    Messages::fail("{$field}.order_line_id", 'order_not_open');
                }

                if ($source->isStock() && ! $deliver) {
                    Messages::fail("{$field}.order_line_id", 'invoice_requires_delivery');
                }

                $perOrder[$source->id] = ($perOrder[$source->id] ?? BigDecimal::zero())->plus($qty);
                $invoiced = $this->quantities->invoicedOnOrder($source->id, $exceptInvoiceId);
                $allowed = $source->isStock()
                    ? $source->quantity->multipliedBy(100 + $this->settings->overDeliveryPercent())->dividedBy(100, 6, RoundingMode::Down)
                    : $source->quantity;

                if ($invoiced->plus($perOrder[$source->id])->isGreaterThan($allowed)) {
                    Messages::fail("{$field}.quantity", 'invoice_exceeds_order', ['remaining' => Sales::qty($allowed->minus($invoiced))]);
                }

                if ($source->isStock() && ! $recheck) {
                    // Goods delivered at issue add to what deliveries already hold of the order line.
                    $perOrderDirect[$source->id] = ($perOrderDirect[$source->id] ?? BigDecimal::zero())->plus($qty);
                    $held = $this->quantities->deliveredOrHeld($source->id);

                    if ($held->plus($perOrderDirect[$source->id])->isGreaterThan($allowed)) {
                        Messages::fail("{$field}.quantity", 'delivery_exceeds_order', ['remaining' => Sales::qty($allowed->minus($held)->isNegative() ? '0' : $allowed->minus($held))]);
                    }
                }

                $currencies[$i] = $order->currency_code;

                $inputs[] = [...$this->fixedLine($source, (string) $qty), 'source_line_id' => $source->id];
                $extras[] = ['delivery_line_id' => null, 'order_line_id' => $source->id];

                continue;
            }

            $inputs[] = array_diff_key($line, ['delivery_line_id' => 1, 'order_line_id' => 1]);
            $extras[] = ['delivery_line_id' => null, 'order_line_id' => null];
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
     * Locks the sources the stored lines name, then the invoice, then again the sources of the
     * lines as they are once the invoice is locked (a concurrent edit may have changed them before;
     * now no line can change any more), so progress is applied to the orders actually invoiced.
     *
     * @return array{0: SalesInvoice, 1: array<string, SalesOrder>}
     */
    private function lockWithSources(SalesInvoice $invoice): array
    {
        $orders = $this->lockSources($this->linesAsInput($invoice));
        $locked = $this->lock($invoice);

        return [$locked, $orders + $this->lockSources($this->linesAsInput($locked))];
    }

    /**
     * Splits an order line over its posted, not yet invoiced delivery lines (oldest first); with
     * deliver_on_invoice the undelivered rest is invoiced against the order line itself.
     *
     * @return list<array<string, mixed>>
     */
    private function allocateOrderLine(SalesOrderLine $line, ?string $quantity, bool $deliver, string $field): array
    {
        if (! $line->isStock()) {
            $open = $line->quantity->minus($this->quantities->invoicedOnOrder($line->id));
            $qty = $quantity === null ? $open : Sales::dec($quantity);

            return $qty->isPositive() ? [['order_line_id' => $line->id, 'quantity' => (string) $qty]] : [];
        }

        $want = $quantity === null ? null : Sales::dec($quantity);
        $out = [];
        $rows = DB::table('sales_delivery_lines as l')->join('sales_deliveries as d', 'd.id', '=', 'l.document_id')
            ->where('l.order_line_id', $line->id)->where('d.status', DeliveryStatus::Posted->value)
            ->orderBy('d.posted_at')->orderBy('l.line_no')->get(['l.id', 'l.quantity']);

        foreach ($rows as $row) {
            if ($want !== null && ! $want->isPositive()) {
                break;
            }

            $free = Sales::dec((string) $row->quantity)->minus($this->quantities->invoicedOnDelivery((string) $row->id));

            if (! $free->isPositive()) {
                continue;
            }

            $take = $want === null ? $free : Sales::min($want, $free);
            $out[] = ['delivery_line_id' => (string) $row->id, 'quantity' => (string) $take];
            $want = $want?->minus($take);
        }

        $rest = $want ?? ($deliver ? $line->quantity->minus($this->quantities->deliveredOrHeld($line->id)) : BigDecimal::zero());

        if ($rest->isPositive()) {
            if (! $deliver) {
                Messages::fail($field, 'invoice_exceeds_delivered', ['remaining' => Sales::qty(BigDecimal::zero())]);
            }

            $out[] = ['order_line_id' => $line->id, 'quantity' => (string) $rest];
        }

        return $out;
    }

    /**
     * Locks the orders and deliveries referenced by the lines (sorted, orders first).
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, SalesOrder>
     */
    private function lockSources(array $lines): array
    {
        $deliveryLineIds = array_values(array_filter(array_map(static fn (array $l): ?string => is_string($l['delivery_line_id'] ?? null) ? $l['delivery_line_id'] : null, $lines)));
        $orderLineIds = array_values(array_filter(array_map(static fn (array $l): ?string => is_string($l['order_line_id'] ?? null) ? $l['order_line_id'] : null, $lines)));
        $deliveryIds = $deliveryLineIds === [] ? [] : SalesDeliveryLine::query()->whereIn('id', $deliveryLineIds)->distinct()->pluck('document_id')->all();
        $orderIds = $orderLineIds === [] ? [] : SalesOrderLine::query()->whereIn('id', $orderLineIds)->distinct()->pluck('document_id')->all();
        $orderIds = array_merge($orderIds, $deliveryIds === [] ? [] : SalesDelivery::query()->whereIn('id', $deliveryIds)->whereNotNull('order_id')->pluck('order_id')->all());
        $orders = $this->lockOrders(array_values(array_unique(array_map('strval', $orderIds))));
        $deliveryIds = array_values(array_unique(array_map('strval', $deliveryIds)));
        sort($deliveryIds);

        foreach ($deliveryIds as $id) {
            SalesDelivery::query()->whereKey($id)->lockForUpdate()->first();
        }

        return $orders;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, SalesOrder>
     */
    private function lockOrders(array $ids): array
    {
        sort($ids);
        $orders = [];

        foreach ($ids as $id) {
            $orders[$id] = SalesOrder::query()->whereKey($id)->lockForUpdate()->firstOrFail();
        }

        return $orders;
    }

    /**
     * @param  Collection<int, SalesInvoiceLine>  $lines
     * @return array<string, string> invoice line id => order id
     */
    private function orderIdsOfLines(Collection $lines): array
    {
        $orderLineIds = $lines->pluck('order_line_id')->filter()->values()->all();
        $orderOf = $orderLineIds === [] ? [] : SalesOrderLine::query()->whereIn('id', $orderLineIds)->pluck('document_id', 'id')->all();
        $map = [];

        foreach ($lines as $line) {
            if ($line->order_line_id !== null && isset($orderOf[$line->order_line_id])) {
                $map[$line->id] = (string) $orderOf[$line->order_line_id];
            }
        }

        return $map;
    }

    /**
     * The stored lines as invoice input (sources kept).
     *
     * @return list<array<string, mixed>>
     */
    private function linesAsInput(SalesInvoice $invoice): array
    {
        $out = [];

        foreach ($invoice->lines()->get() as $line) {
            $input = $this->fixedLine($line, (string) $line->quantity);

            if ($line->delivery_line_id !== null) {
                $input = ['delivery_line_id' => $line->delivery_line_id, 'quantity' => (string) $line->quantity];
            } elseif ($line->order_line_id !== null) {
                $input = ['order_line_id' => $line->order_line_id, 'quantity' => (string) $line->quantity];
            }

            $out[] = $input;
        }

        return $out;
    }

    /**
     * @param  list<array<string, mixed>>  $lines  composed lines
     * @param  list<array<string, mixed>>  $extras
     */
    private function assertDeliverable(array $lines, array $extras, bool $deliver): void
    {
        foreach ($lines as $i => $line) {
            if (($line['item_type'] ?? null) === 'stock' && ($extras[$i]['delivery_line_id'] ?? null) === null && ! $deliver) {
                Messages::fail("lines.{$i}.item_id", 'invoice_requires_delivery');
            }
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $extras
     * @return array<string, mixed>
     */
    private function headerExtras(array $data, array $extras): array
    {
        $orderLineIds = array_values(array_filter(array_column($extras, 'order_line_id')));
        $orderIds = $orderLineIds === [] ? [] : SalesOrderLine::query()->whereIn('id', $orderLineIds)->distinct()->pluck('document_id')->all();

        return [
            'deliver_on_invoice' => (bool) ($data['deliver_on_invoice'] ?? false),
            'order_id' => count($orderIds) === 1 ? (string) $orderIds[0] : null,
        ];
    }

    /**
     * Header of a converted invoice: the source's party and currency, a new date (and rate, due date).
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function convertedHeader(SalesOrder|SalesDelivery $source, array $data): array
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
}
