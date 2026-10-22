<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\RequestStatus;
use App\Modules\Purchasing\Models\PurchaseDocument;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseRequestLine;
use App\Modules\Purchasing\Services\Composer\DocumentComposer;
use App\Modules\Purchasing\Services\Machines\RequestMachine;
use App\Modules\Purchasing\Support\Messages;
use App\Modules\Purchasing\Support\Purchasing;
use App\Modules\Purchasing\Support\PurchasingSettings;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Purchase requests: drafts, submission (approval above purchasing.request_approval_over through
 * the approval engine, otherwise approved at once), cancel, and conversion into an order of one
 * supplier, bounded by what the request lines still lack (under the request row lock).
 */
final class RequestService extends DocumentService
{
    public const string APPROVAL_TYPE = 'purchase_request';

    public function __construct(
        DocumentComposer $composer,
        DocumentStore $store,
        private readonly RequestMachine $machine,
        private readonly Quantities $quantities,
        private readonly RequestProgress $progress,
        private readonly ApprovalEngine $approvals,
        private readonly PurchasingSettings $settings,
        private readonly Notifier $notifier,
    ) {
        parent::__construct($composer, $store);
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    public function create(array $data, array $lines, ?Authenticatable $actor): PurchaseRequest
    {
        return Purchasing::transaction(function () use ($data, $lines, $actor): PurchaseRequest {
            $request = new PurchaseRequest;
            $request->created_by = self::actorId($actor);
            $request->requested_by = self::actorId($actor);
            $this->write($request, $data, $lines);

            return $request;
        });
    }

    /**
     * A draft is rewritten; a rejected request is reopened as a draft by the edit.
     *
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function update(PurchaseRequest $request, array $data, ?array $lines, int $version): PurchaseRequest
    {
        return Purchasing::transaction(function () use ($request, $data, $lines, $version): PurchaseRequest {
            $request = $this->lock($request, $version);
            $this->assertStatus($request, [RequestStatus::Draft, RequestStatus::Rejected], RequestStatus::Draft->value);

            if ($request->status === RequestStatus::Rejected) {
                $this->machine->transition($request, RequestStatus::Draft);
            }

            $stored = array_values($request->lines()->get()->map(static fn (PurchaseRequestLine $l): array => [
                'item_id' => $l->item_id, 'variant_id' => $l->variant_id, 'unit_id' => $l->unit_id, 'quantity' => (string) $l->quantity,
                'estimated_price' => (string) $l->estimated_price, 'suggested_supplier_id' => $l->suggested_supplier_id,
                'needed_by' => $l->needed_by?->format('Y-m-d'), 'warehouse_id' => $l->warehouse_id, 'description' => $l->description,
            ])->all());
            $request->bumpVersion();
            $this->write($request, $data, $lines ?? $stored);

            return $request;
        });
    }

    public function delete(PurchaseRequest $request, ?int $version): void
    {
        Purchasing::transaction(function () use ($request, $version): void {
            $request = $this->lock($request, $version);
            $this->assertStatus($request, [RequestStatus::Draft, RequestStatus::Rejected], 'deleted');
            $request->delete();
        });
    }

    /** Number, then approval above the threshold or approved at once. */
    public function submit(PurchaseRequest $request, ?int $version, ?Authenticatable $actor): PurchaseRequest
    {
        return Purchasing::transaction(function () use ($request, $version, $actor): PurchaseRequest {
            $request = $this->lock($request, $version);
            $this->assertStatus($request, [RequestStatus::Draft], RequestStatus::PendingApproval->value);

            if ($request->lines()->count() === 0) {
                Messages::fail('lines', 'lines_required');
            }

            $this->store->assignNumber($request, DocumentKind::Request);
            $request->submitted_at = now();
            $request->approval_comment = null;
            $threshold = $this->settings->requestApprovalThreshold();

            if ($threshold !== null && $request->estimated_total->isGreaterThanOrEqualTo($threshold)) {
                $this->machine->transition($request, RequestStatus::PendingApproval, $actor);
                $approval = $this->approvals->start($request, self::APPROVAL_TYPE, (string) $request->estimated_total);
                DB::table('purchase_requests')->where('id', $request->id)->update(['approval_request_id' => $approval->getKey()]);
                $request->setRawAttributes([...$request->getAttributes(), 'approval_request_id' => $approval->getKey()], true);

                return $request;
            }

            $request->approved_at = now();

            return $this->machine->transition($request, RequestStatus::Approved, $actor);
        });
    }

    public function cancel(PurchaseRequest $request, ?int $version, ?Authenticatable $actor): PurchaseRequest
    {
        return Purchasing::transaction(function () use ($request, $version, $actor): PurchaseRequest {
            $request = $this->lock($request, $version);
            $this->assertStatus($request, [RequestStatus::Draft, RequestStatus::PendingApproval, RequestStatus::Rejected, RequestStatus::Approved, RequestStatus::PartiallyOrdered],
                RequestStatus::Cancelled->value);

            $used = DB::table('purchase_order_lines as l')->join('purchase_orders as o', 'o.id', '=', 'l.document_id')
                ->join('purchase_request_lines as r', 'r.id', '=', 'l.request_line_id')
                ->where('r.document_id', $request->id)->whereIn('o.status', ['draft', 'pending_approval'])->exists();

            if ($used) {
                Messages::fail('request', 'request_has_draft_orders');
            }

            $request->cancelled_at = now();

            return $this->machine->transition($request, RequestStatus::Cancelled, $actor);
        });
    }

    /**
     * Draft order of one supplier from the request (lines: request_line_id, quantity, unit_price;
     * omitted = everything still open at the estimated prices).
     *
     * @param  array<string, mixed>  $data  party_id, document_date, expected_date, currency_code, warehouse_id, notes
     * @param  list<array<string, mixed>>|null  $lines
     */
    public function createOrder(PurchaseRequest $request, array $data, ?array $lines, ?Authenticatable $actor, bool $canOverridePrice): PurchaseOrder
    {
        return Purchasing::transaction(function () use ($request, $data, $lines, $actor, $canOverridePrice): PurchaseOrder {
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
            $extras = [];
            $seen = [];

            foreach ($lines as $i => $line) {
                $id = is_string($line['request_line_id'] ?? null) ? $line['request_line_id'] : '';
                $source = $requestLines->get($id);

                if (! $source instanceof PurchaseRequestLine || isset($seen[$id])) {
                    Messages::fail("lines.{$i}.request_line_id", 'source_line_unknown');
                }

                $seen[$id] = true;
                $qty = Purchasing::dec(is_string($line['quantity'] ?? null) ? $line['quantity'] : '0');
                $this->assertWithinRequest($source, $qty, "lines.{$i}.quantity");
                $price = is_string($line['unit_price'] ?? null) && $line['unit_price'] !== '' ? $line['unit_price'] : (string) $source->estimated_price;
                $base = $qty->isEqualTo($source->quantity) ? $source->base_quantity
                    : $source->base_quantity->multipliedBy($qty)->dividedBy($source->quantity, 6, RoundingMode::HalfUp);
                $inputs[] = [
                    'item_id' => $source->item_id, 'variant_id' => $source->variant_id, 'unit_id' => $source->unit_id, 'quantity' => (string) $qty,
                    'unit_price' => $price, 'description' => $source->description, 'warehouse_id' => $source->warehouse_id,
                    'source_line_id' => $source->id, '_price_source' => 'request', '_base_quantity' => (string) $base,
                ];
                $extras[] = ['request_line_id' => $source->id, 'expected_date' => $source->needed_by?->format('Y-m-d')];
            }

            $header = [
                'party_id' => $data['party_id'] ?? null,
                'document_date' => $data['document_date'] ?? now()->toDateString(),
                'currency_code' => $data['currency_code'] ?? null,
                'warehouse_id' => $data['warehouse_id'] ?? $request->warehouse_id,
                'cost_center_id' => $request->cost_center_id,
                'project_id' => $request->project_id,
                'notes' => $data['notes'] ?? null,
            ];
            $composed = $this->compose($header, $inputs, $canOverridePrice);
            $order = $this->store->create(new PurchaseOrder, $composed, [
                'request_id' => $request->id, 'source_type' => 'purchase_request', 'source_id' => $request->id,
                'expected_date' => $data['expected_date'] ?? $request->needed_by?->format('Y-m-d'),
            ], $extras, self::actorId($actor));
            $this->progress->refresh($request->id);

            return $order;
        });
    }

    /** Approval granted (ApprovalCompleted). */
    public function approvalCompleted(string $requestId): void
    {
        $request = Purchasing::transaction(function () use ($requestId): ?PurchaseRequest {
            $request = PurchaseRequest::query()->whereKey($requestId)->lockForUpdate()->first();

            if ($request === null || $request->status !== RequestStatus::PendingApproval) {
                return null;
            }

            $request->approved_at = now();

            return $this->machine->transition($request, RequestStatus::Approved);
        });

        if ($request !== null) {
            $this->notifyCreator($request, 'request_approval_granted');
        }
    }

    /** Approval rejected: the request is rejected (an edit reopens it). */
    public function approvalRejected(string $requestId): void
    {
        $request = Purchasing::transaction(function () use ($requestId): ?PurchaseRequest {
            $request = PurchaseRequest::query()->whereKey($requestId)->lockForUpdate()->first();

            if ($request === null || $request->status !== RequestStatus::PendingApproval) {
                return null;
            }

            $request->rejected_at = now();
            $request->approval_comment = Messages::get('approval_rejected_comment');

            return $this->machine->transition($request, RequestStatus::Rejected);
        });

        if ($request !== null) {
            $this->notifyCreator($request, 'request_approval_rejected');
        }
    }

    public function assertWithinRequest(PurchaseRequestLine $line, BigDecimal $qty, string $field, ?string $exceptOrderId = null): void
    {
        if (! $qty->isPositive()) {
            Messages::fail($field, 'quantity_positive');
        }

        $ordered = $this->quantities->orderedOnRequest($line->id, $exceptOrderId);

        if ($ordered->plus($qty)->isGreaterThan($line->quantity)) {
            $open = $line->quantity->minus($ordered);
            Messages::fail($field, 'order_exceeds_request', ['remaining' => Purchasing::qty($open->isNegative() ? '0' : $open)]);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array<string, mixed>>  $lines
     */
    private function write(PurchaseRequest $request, array $data, array $lines): void
    {
        if ($lines === []) {
            Messages::fail('lines', 'lines_required');
        }

        if (count($lines) > PurchaseDocument::MAX_LINES) {
            Messages::fail('lines', 'too_many_lines', ['max' => PurchaseDocument::MAX_LINES]);
        }

        $header = [];

        foreach (['document_date', 'needed_by', 'warehouse_id', 'cost_center_id', 'project_id', 'notes', 'internal_notes'] as $column) {
            if (array_key_exists($column, $data)) {
                $header[$column] = $data[$column] === '' ? null : $data[$column];
            }
        }

        $request->forceFill($header);
        $request->document_date ??= now()->startOfDay();
        $request->currency_code = $this->settings->baseCurrency();
        $this->composer->assertWarehouse($request->warehouse_id, 'warehouse_id');
        $this->composer->assertDimensions(['cost_center_id' => $request->cost_center_id, 'project_id' => $request->project_id]);
        $rows = [];
        $total = BigDecimal::zero()->toScale(4);

        foreach ($lines as $i => $line) {
            $field = "lines.{$i}";
            $q = $this->composer->quantities($line, $field);
            $price = Purchasing::dec(DocumentComposer::str($line['estimated_price'] ?? null) ?? '0');

            if ($price->isNegative()) {
                Messages::fail("{$field}.estimated_price", 'price_negative');
            }

            $supplier = DocumentComposer::str($line['suggested_supplier_id'] ?? null);

            if ($supplier !== null) {
                $this->composer->supplier($supplier, "{$field}.suggested_supplier_id");
            }

            $warehouse = DocumentComposer::str($line['warehouse_id'] ?? null);
            $this->composer->assertWarehouse($warehouse, "{$field}.warehouse_id");
            $lineTotal = BigDecimal::of($q['quantity'])->multipliedBy($price)->toScale(4, RoundingMode::HalfUp);
            $total = $total->plus($lineTotal);
            $rows[] = [
                'line_no' => $i + 1, 'item_id' => $q['item']->id, 'variant_id' => $q['variant'], 'item_type' => $q['item']->type,
                'description' => DocumentComposer::str($line['description'] ?? null) ?? mb_substr($q['item']->name, 0, 500),
                'quantity' => $q['quantity'], 'unit_id' => $q['unit'], 'base_quantity' => $q['base'],
                'estimated_price' => Purchasing::qty($price), 'estimated_total' => (string) $lineTotal, 'suggested_supplier_id' => $supplier,
                'needed_by' => DocumentComposer::str($line['needed_by'] ?? null), 'warehouse_id' => $warehouse,
            ];
        }

        $request->setAttribute('estimated_total', (string) $total);
        $request->save();
        PurchaseRequestLine::query()->where('document_id', $request->id)->delete();

        foreach ($rows as $row) {
            $line = new PurchaseRequestLine($row);
            $line->document_id = $request->id;
            $line->save();
        }

        $request->unsetRelation('lines');
    }

    private function notifyCreator(PurchaseRequest $request, string $key): void
    {
        if ($request->created_by === null) {
            return;
        }

        try {
            $this->notifier->notify($request->created_by, 'purchasing.'.$key, [
                'title' => Messages::get($key.'_title', ['number' => (string) $request->number]),
                'body' => Messages::get($key.'_body', ['number' => (string) $request->number]),
                'url' => '/purchasing/requests/'.$request->id,
                'request_id' => $request->id,
            ]);
        } catch (\Throwable $e) {
            Log::warning('purchasing approval notification failed', ['request' => $request->id, 'error' => $e->getMessage()]);
        }
    }
}
