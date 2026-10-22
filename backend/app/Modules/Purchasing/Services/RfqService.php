<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\RequestStatus;
use App\Modules\Purchasing\Enums\RfqStatus;
use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseRequestLine;
use App\Modules\Purchasing\Models\PurchaseRfq;
use App\Modules\Purchasing\Models\PurchaseRfqLine;
use App\Modules\Purchasing\Models\RfqQuote;
use App\Modules\Purchasing\Models\RfqSupplier;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Services\Machines\RfqMachine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Str;

/**
 * Requests for quotation: one RFQ (in one currency) goes to several suppliers, their quotes are
 * entered per line, the comparison ranks them by price and lead time, and the award (one supplier
 * for everything or a supplier per line) creates one draft order per supplier at the quoted prices.
 * Lines taken from a request are bounded by the request quantity still not ordered at award time.
 */
final class RfqService extends DocumentService
{
    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly RfqMachine $machine,
        private readonly Quantities $quantities,
        private readonly RequestProgress $requests,
        private readonly RequestService $requestService,
        private readonly PurchasingSettings $settings,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data  header fields and supplier_ids
     * @param  list<array<string, mixed>>  $lines
     */
    public function create(array $data, array $lines, ?Authenticatable $actor): PurchaseRfq
    {
        return Purchasing::transaction(function () use ($data, $lines, $actor): PurchaseRfq {
            $rfq = new PurchaseRfq;
            $rfq->created_by = self::actorId($actor);
            $this->write($rfq, $data, $lines, self::ids($data['supplier_ids'] ?? []));

            return $rfq;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(PurchaseRfq $rfq, array $data, ?array $lines, int $version): PurchaseRfq
    {
        return Purchasing::transaction(function () use ($rfq, $data, $lines, $version): PurchaseRfq {
            $rfq = $this->lock($rfq, $version);
            $this->assertDraft($rfq);
            $lines ??= array_values($rfq->lines()->get()->map(static fn (PurchaseRfqLine $l): array => [
                'item_id' => $l->item_id, 'variant_id' => $l->variant_id, 'unit_id' => $l->unit_id, 'quantity' => (string) $l->quantity,
                'description' => $l->description, 'needed_by' => $l->needed_by?->format('Y-m-d'), 'request_line_id' => $l->request_line_id,
            ])->all());
            $suppliers = array_key_exists('supplier_ids', $data) ? self::ids($data['supplier_ids']) : array_values($rfq->suppliers()->pluck('party_id')->all());
            $rfq->bumpVersion();
            $this->write($rfq, $data, $lines, array_map('strval', $suppliers));

            return $rfq;
        });
    }

    public function delete(PurchaseRfq $rfq, ?int $version): void
    {
        Purchasing::transaction(function () use ($rfq, $version): void {
            $rfq = $this->lock($rfq, $version);
            $this->assertDraft($rfq);
            $rfq->delete();
        });
    }

    /**
     * RFQ of an approved request (lines: request_line_id, quantity; omitted = everything still open).
     *
     * @param  array<string, mixed>  $data  supplier_ids, document_date, response_due, currency_code, notes
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function createFromRequest(PurchaseRequest $request, array $data, ?array $lines, ?Authenticatable $actor): PurchaseRfq
    {
        return Purchasing::transaction(function () use ($request, $data, $lines, $actor): PurchaseRfq {
            $request = $this->lock($request);

            if (! in_array($request->status, RequestStatus::open(), true)) {
                Messages::fail('request', 'request_not_open');
            }

            $requestLines = $request->lines()->get()->keyBy('id');

            if ($lines === null) {
                $lines = [];

                foreach ($requestLines as $line) {
                    $open = $line->quantity->minus($this->quantities->orderedOnRequest($line->id));

                    if ($open->isPositive()) {
                        $lines[] = ['request_line_id' => $line->id, 'quantity' => (string) $open];
                    }
                }

                if ($lines === []) {
                    Messages::fail('lines', 'nothing_to_order');
                }
            }

            $inputs = [];

            foreach ($lines as $i => $line) {
                $source = $requestLines->get(is_string($line['request_line_id'] ?? null) ? $line['request_line_id'] : '');

                if (! $source instanceof PurchaseRequestLine) {
                    Messages::fail("lines.{$i}.request_line_id", 'source_line_unknown');
                }

                $qty = Purchasing::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
                $this->requestService->assertWithinRequest($source, $qty, "lines.{$i}.quantity");
                $inputs[] = [
                    'item_id' => $source->item_id, 'variant_id' => $source->variant_id, 'unit_id' => $source->unit_id, 'quantity' => (string) $qty,
                    'description' => $source->description, 'needed_by' => $source->needed_by?->format('Y-m-d') ?? $request->needed_by?->format('Y-m-d'),
                    'request_line_id' => $source->id,
                    '_base_quantity' => (string) ($qty->isEqualTo($source->quantity) ? $source->base_quantity
                        : $source->base_quantity->multipliedBy($qty)->dividedBy($source->quantity, 6, RoundingMode::HalfUp)),
                ];
            }

            $rfq = new PurchaseRfq;
            $rfq->created_by = self::actorId($actor);
            $rfq->request_id = $request->id;
            $this->write($rfq, [...$data, 'warehouse_id' => $data['warehouse_id'] ?? $request->warehouse_id], $inputs, self::ids($data['supplier_ids'] ?? []));

            return $rfq;
        });
    }

    public function send(PurchaseRfq $rfq, ?int $version, ?Authenticatable $actor): PurchaseRfq
    {
        return Purchasing::transaction(function () use ($rfq, $version, $actor): PurchaseRfq {
            $rfq = $this->lock($rfq, $version);
            $this->assertStatus($rfq, [RfqStatus::Draft], RfqStatus::Sent->value);

            if ($rfq->lines()->count() === 0) {
                Messages::fail('lines', 'lines_required');
            }

            if ($rfq->suppliers()->count() === 0) {
                Messages::fail('supplier_ids', 'rfq_suppliers_required');
            }

            $this->store->assignNumber($rfq, DocumentKind::Rfq);
            $rfq->sent_at = now();

            return $this->machine->transition($rfq, RfqStatus::Sent, $actor);
        });
    }

    public function cancel(PurchaseRfq $rfq, ?int $version, ?Authenticatable $actor): PurchaseRfq
    {
        return Purchasing::transaction(function () use ($rfq, $version, $actor): PurchaseRfq {
            $rfq = $this->lock($rfq, $version);
            $this->assertStatus($rfq, [RfqStatus::Draft, RfqStatus::Sent, RfqStatus::Collecting], RfqStatus::Cancelled->value);
            $rfq->cancelled_at = now();

            return $this->machine->transition($rfq, RfqStatus::Cancelled, $actor);
        });
    }

    /**
     * Records (or replaces) one supplier's quotes; declined marks the supplier as not quoting.
     *
     * @param  list<array<string, mixed>>  $quotes  rfq_line_id, unit_price, discount_percent, lead_time_days, valid_until, notes
     */
    public function quote(PurchaseRfq $rfq, string $partyId, array $quotes, bool $declined, ?int $version, ?Authenticatable $actor): PurchaseRfq
    {
        return Purchasing::transaction(function () use ($rfq, $partyId, $quotes, $declined, $version, $actor): PurchaseRfq {
            $rfq = $this->lock($rfq, $version);
            $this->assertStatus($rfq, [RfqStatus::Sent, RfqStatus::Collecting], RfqStatus::Collecting->value);
            $supplier = RfqSupplier::query()->where('rfq_id', $rfq->id)->where('party_id', $partyId)->first();

            if ($supplier === null) {
                Messages::fail('party_id', 'rfq_supplier_unknown');
            }

            $lineIds = $rfq->lines()->pluck('id')->all();
            RfqQuote::query()->where('rfq_id', $rfq->id)->where('party_id', $partyId)->delete();

            if (! $declined) {
                if ($quotes === []) {
                    Messages::fail('quotes', 'lines_required');
                }

                $seen = [];

                foreach ($quotes as $i => $q) {
                    $lineId = is_string($q['rfq_line_id'] ?? null) ? $q['rfq_line_id'] : '';

                    if (! in_array($lineId, $lineIds, true) || isset($seen[$lineId])) {
                        Messages::fail("quotes.{$i}.rfq_line_id", 'source_line_unknown');
                    }

                    $seen[$lineId] = true;
                    $quote = new RfqQuote([
                        'rfq_line_id' => $lineId, 'party_id' => $partyId,
                        'unit_price' => Purchasing::qty(is_string($q['unit_price'] ?? null) ? $q['unit_price'] : '0'),
                        'discount_percent' => (string) Purchasing::dec(is_string($q['discount_percent'] ?? null) ? $q['discount_percent'] : '0')->toScale(4, RoundingMode::HalfUp),
                        'lead_time_days' => is_numeric($q['lead_time_days'] ?? null) ? (int) $q['lead_time_days'] : null,
                        'valid_until' => is_string($q['valid_until'] ?? null) ? $q['valid_until'] : null,
                        'notes' => is_string($q['notes'] ?? null) ? $q['notes'] : null,
                    ]);
                    $quote->rfq_id = $rfq->id;
                    $quote->save();
                }
            }

            $supplier->status = $declined ? 'declined' : 'responded';
            $supplier->responded_at = now();
            $supplier->save();
            activity()->performedOn($rfq)->causedBy(self::causer($actor))->withProperties(['party_id' => $partyId, 'declined' => $declined, 'lines' => count($quotes)])
                ->event('quote_recorded')->log('quote_recorded');

            if ($rfq->status === RfqStatus::Sent) {
                return $this->machine->transition($rfq, RfqStatus::Collecting, $actor);
            }

            $rfq->bumpVersion();
            $rfq->save();

            return $rfq;
        });
    }

    /**
     * Comparison matrix: per line every quote with its net price and line total, the lowest price
     * and shortest lead time flagged; per supplier the total of what it quoted.
     *
     * @return array<string, mixed>
     */
    public function comparison(PurchaseRfq $rfq): array
    {
        $suppliers = $rfq->suppliers()->get()->keyBy('party_id');
        $quotes = $rfq->quotes()->get()->groupBy('rfq_line_id');
        $totals = [];
        $lines = [];

        foreach ($rfq->lines()->get() as $line) {
            $rows = [];
            $lowest = null;
            $fastest = null;

            foreach ($quotes->get($line->id, collect()) as $quote) {
                /** @var RfqQuote $quote */
                $net = $quote->netPrice();
                $total = $net->multipliedBy($line->quantity)->toScale(2, RoundingMode::HalfUp);
                $lowest = $lowest === null || $net->isLessThan($lowest) ? $net : $lowest;
                $fastest = $quote->lead_time_days !== null && ($fastest === null || $quote->lead_time_days < $fastest) ? $quote->lead_time_days : $fastest;
                $totals[$quote->party_id] = ($totals[$quote->party_id] ?? ['total' => BigDecimal::zero(), 'lines' => 0]);
                $totals[$quote->party_id]['total'] = $totals[$quote->party_id]['total']->plus($total);
                $totals[$quote->party_id]['lines']++;
                $rows[] = [
                    'quote_id' => $quote->id, 'party_id' => $quote->party_id, 'party_name' => $suppliers->get($quote->party_id)?->party_name,
                    'unit_price' => (string) $quote->unit_price, 'discount_percent' => (string) $quote->discount_percent, 'net_unit_price' => (string) $net,
                    'line_total' => (string) $total, 'lead_time_days' => $quote->lead_time_days, 'valid_until' => $quote->valid_until?->format('Y-m-d'),
                    'notes' => $quote->notes, '_net' => $net,
                ];
            }

            usort($rows, static fn (array $a, array $b): int => $a['_net']->compareTo($b['_net']));
            $rows = array_map(static fn (array $r): array => [
                ...array_diff_key($r, ['_net' => true]),
                'lowest_price' => $lowest !== null && $r['_net']->isEqualTo($lowest),
                'fastest' => $fastest !== null && $r['lead_time_days'] === $fastest,
            ], $rows);
            $lines[] = [
                'rfq_line_id' => $line->id, 'line_no' => $line->line_no, 'item_id' => $line->item_id, 'description' => $line->description,
                'quantity' => (string) $line->quantity, 'unit_id' => $line->unit_id, 'awarded_party_id' => $line->awarded_party_id, 'quotes' => $rows,
            ];
        }

        $lineCount = count($lines);
        $summary = [];
        $best = null;

        foreach ($suppliers as $supplier) {
            $t = $totals[$supplier->party_id] ?? null;
            $complete = $t !== null && $t['lines'] === $lineCount;
            $summary[] = [
                'party_id' => $supplier->party_id, 'party_name' => $supplier->party_name, 'status' => $supplier->status,
                'lines_quoted' => $t['lines'] ?? 0, 'total' => $t === null ? null : (string) $t['total']->toScale(2), 'complete' => $complete,
            ];

            if ($complete && ($best === null || $t['total']->isLessThan($best[1]))) {
                $best = [$supplier->party_id, $t['total']];
            }
        }

        return ['rfq_id' => $rfq->id, 'currency_code' => $rfq->currency_code, 'lines' => $lines, 'suppliers' => $summary, 'lowest_total_party_id' => $best[0] ?? null];
    }

    /**
     * Award: party_id (that supplier's quotes for every line it quoted) or lines (rfq_line_id,
     * party_id). One draft order per supplier at the quoted price and discount.
     *
     * @param  array<string, mixed>  $data  party_id?, lines?, document_date, expected_date, warehouse_id
     * @return list<PurchaseOrder>
     */
    public function award(PurchaseRfq $rfq, array $data, ?int $version, ?Authenticatable $actor): array
    {
        return Purchasing::transaction(function () use ($rfq, $data, $version, $actor): array {
            if ($rfq->request_id !== null) {
                PurchaseRequest::query()->whereKey($rfq->request_id)->lockForUpdate()->first();
            }

            $rfq = $this->lock($rfq, $version);
            $this->assertStatus($rfq, [RfqStatus::Sent, RfqStatus::Collecting], RfqStatus::Awarded->value);
            $rfqLines = $rfq->lines()->get()->keyBy('id');
            $quotes = $rfq->quotes()->get();
            $picks = [];

            if (is_array($data['lines'] ?? null)) {
                foreach (array_values($data['lines']) as $i => $pick) {
                    $lineId = is_array($pick) && is_string($pick['rfq_line_id'] ?? null) ? $pick['rfq_line_id'] : '';
                    $partyId = is_array($pick) && is_string($pick['party_id'] ?? null) ? $pick['party_id'] : '';
                    $quote = $quotes->first(static fn (RfqQuote $q): bool => $q->rfq_line_id === $lineId && $q->party_id === $partyId);

                    if (! $rfqLines->has($lineId) || isset($picks[$lineId])) {
                        Messages::fail("lines.{$i}.rfq_line_id", 'source_line_unknown');
                    }

                    if (! $quote instanceof RfqQuote) {
                        Messages::fail("lines.{$i}.party_id", 'rfq_quote_missing');
                    }

                    $picks[$lineId] = $quote;
                }
            } else {
                $partyId = is_string($data['party_id'] ?? null) ? $data['party_id'] : '';

                foreach ($quotes->where('party_id', $partyId) as $quote) {
                    $picks[$quote->rfq_line_id] = $quote;
                }

                if ($picks === []) {
                    Messages::fail('party_id', 'rfq_quote_missing');
                }
            }

            $byParty = [];

            foreach ($picks as $lineId => $quote) {
                $byParty[$quote->party_id][] = [$rfqLines->get($lineId), $quote];
            }

            ksort($byParty);
            $orders = [];

            foreach ($byParty as $partyId => $rows) {
                $inputs = [];
                $extras = [];

                foreach ($rows as $n => [$line, $quote]) {
                    /** @var PurchaseRfqLine $line */
                    /** @var RfqQuote $quote */
                    if ($line->request_line_id !== null) {
                        $requestLine = PurchaseRequestLine::query()->whereKey($line->request_line_id)->firstOrFail();
                        $this->requestService->assertWithinRequest($requestLine, $line->quantity, "lines.{$n}.quantity");
                    }

                    $inputs[] = [
                        'item_id' => $line->item_id, 'variant_id' => $line->variant_id, 'unit_id' => $line->unit_id, 'quantity' => (string) $line->quantity,
                        'unit_price' => (string) $quote->unit_price, 'discount_percent' => (string) $quote->discount_percent, 'description' => $line->description,
                        'source_line_id' => $line->id, '_price_source' => 'quote', '_base_quantity' => (string) $line->base_quantity,
                    ];
                    $extras[] = [
                        'rfq_line_id' => $line->id, 'request_line_id' => $line->request_line_id,
                        'expected_date' => $quote->lead_time_days === null ? $line->needed_by?->format('Y-m-d')
                            : now()->addDays($quote->lead_time_days)->toDateString(),
                    ];
                    $line->awarded_party_id = $quote->party_id;
                    $line->awarded_quote_id = $quote->id;
                    $line->save();
                }

                $composed = $this->compose([
                    'party_id' => $partyId, 'document_date' => $data['document_date'] ?? now()->toDateString(), 'currency_code' => $rfq->currency_code,
                    'warehouse_id' => $data['warehouse_id'] ?? $rfq->warehouse_id,
                ], $inputs, true);
                $orders[] = $this->store->create(new PurchaseOrder, $composed, [
                    'rfq_id' => $rfq->id, 'request_id' => $rfq->request_id, 'source_type' => 'purchase_rfq', 'source_id' => $rfq->id,
                    'expected_date' => $data['expected_date'] ?? null,
                ], $extras, self::actorId($actor));
            }

            $rfq->awarded_at = now();
            $rfq->awarded_by = self::actorId($actor);
            $this->machine->transition($rfq, RfqStatus::Awarded, $actor);
            $this->requests->refresh($rfq->request_id);

            return $orders;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     * @param  list<string>  $supplierIds
     */
    private function write(PurchaseRfq $rfq, array $data, array $lines, array $supplierIds): void
    {
        if ($lines === []) {
            Messages::fail('lines', 'lines_required');
        }

        if (count($lines) > PurchaseDocument::MAX_LINES) {
            Messages::fail('lines', 'too_many_lines', ['max' => PurchaseDocument::MAX_LINES]);
        }

        foreach (['document_date', 'response_due', 'warehouse_id', 'notes', 'internal_notes'] as $column) {
            if (array_key_exists($column, $data)) {
                $rfq->setAttribute($column, $data[$column] === '' ? null : $data[$column]);
            }
        }

        if ($rfq->getAttribute('document_date') === null) {
            $rfq->setAttribute('document_date', now()->toDateString());
        }

        $currency = DocumentComposer::str($data['currency_code'] ?? null) ?? ($rfq->exists ? $rfq->currency_code : $this->settings->baseCurrency());
        $this->composer->assertCurrency($currency);
        $rfq->currency_code = $currency;
        $this->composer->assertWarehouse($rfq->warehouse_id, 'warehouse_id');
        $parties = [];

        foreach (array_values(array_unique($supplierIds)) as $i => $partyId) {
            $parties[] = $this->composer->supplier($partyId, "supplier_ids.{$i}");
        }

        $rows = [];

        foreach ($lines as $i => $line) {
            $field = "lines.{$i}";
            $q = $this->composer->quantities($line, $field);
            $rows[] = [
                'line_no' => $i + 1, 'item_id' => $q['item']->id, 'variant_id' => $q['variant'], 'item_type' => $q['item']->type,
                'description' => DocumentComposer::str($line['description'] ?? null) ?? mb_substr($q['item']->name, 0, 500),
                'quantity' => $q['quantity'], 'unit_id' => $q['unit'], 'base_quantity' => $q['base'],
                'needed_by' => DocumentComposer::str($line['needed_by'] ?? null),
                'request_line_id' => DocumentComposer::str($line['request_line_id'] ?? null),
            ];
        }

        $rfq->save();
        PurchaseRfqLine::query()->where('document_id', $rfq->id)->delete();

        foreach ($rows as $row) {
            $line = new PurchaseRfqLine($row);
            $line->document_id = $rfq->id;
            $line->save();
        }

        RfqSupplier::query()->where('rfq_id', $rfq->id)->delete();

        foreach ($parties as $party) {
            $supplier = new RfqSupplier(['party_id' => $party->id, 'party_name' => $party->legalName ?? $party->name]);
            $supplier->rfq_id = $rfq->id;
            $supplier->save();
        }

        $rfq->unsetRelation('lines');
        $rfq->unsetRelation('suppliers');
    }

    /**
     * @return list<string>
     */
    private static function ids(mixed $value): array
    {
        return is_array($value) ? array_values(array_filter($value, static fn (mixed $v): bool => is_string($v) && Str::isUuid($v))) : [];
    }
}
