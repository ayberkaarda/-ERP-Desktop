<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Contracts\UnitLookup;
use App\Modules\Catalog\Data\ItemData;
use App\Modules\Catalog\Services\UnitConversionMissing;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\StockDocumentLine;
use App\Modules\Inventory\Services\Ledger\StockLedger;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use Illuminate\Support\Facades\DB;

/**
 * Draft stock documents: header and lines (quantities converted to the item's base unit when
 * saved), count snapshots and counted quantities. Posting and reversal are StockLedger's.
 */
final class StockDocuments
{
    public function __construct(
        private readonly ItemLookup $items,
        private readonly UnitLookup $units,
        private readonly WarehouseDirectory $warehouses,
    ) {}

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data, ?string $actor): StockDocument
    {
        return Stock::transaction(function () use ($data, $actor): StockDocument {
            $doc = new StockDocument;
            $this->fill($doc, $data);
            $doc->created_by = $actor;

            if ($doc->doc_type === DocumentType::Count) {
                $doc->frozen_at = now();
            }

            $doc->save();
            $lines = is_array($data['lines'] ?? null) ? array_values($data['lines']) : [];

            if ($doc->doc_type === DocumentType::Count && ($data['freeze'] ?? true) !== false) {
                $this->snapshot($doc, is_array($data['item_ids'] ?? null) ? array_values(array_filter($data['item_ids'], 'is_string')) : []);
                $this->addCountLines($doc, $lines);
            } else {
                $this->writeLines($doc, $lines);
            }

            return $doc;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(StockDocument $document, array $data, int $version): StockDocument
    {
        return Stock::transaction(function () use ($document, $data, $version): StockDocument {
            $doc = $this->lockedDraft($document, $version);

            if (isset($data['doc_type']) && $data['doc_type'] !== $doc->doc_type->value) {
                Messages::fail('doc_type', 'doc_type_fixed');
            }

            $this->fill($doc, $data);
            $doc->bumpVersion();
            $doc->save();

            if (array_key_exists('lines', $data) && is_array($data['lines'])) {
                if ($doc->doc_type === DocumentType::Count) {
                    Messages::fail('lines', 'count_lines_via_counts');
                }

                $this->writeLines($doc, array_values($data['lines']));
            }

            return $doc;
        });
    }

    public function delete(StockDocument $document, ?int $version): void
    {
        Stock::transaction(function () use ($document, $version): void {
            $this->lockedDraft($document, $version)->delete();
        });
    }

    /**
     * Counted quantities of a count document: existing lines by id (null = not counted) and new
     * lines for stock found outside the snapshot (system quantity = on hand when added).
     *
     * @param  list<array<string, mixed>>  $counts
     * @param  list<array<string, mixed>>  $add
     */
    public function counts(StockDocument $document, int $version, array $counts, array $add): StockDocument
    {
        return Stock::transaction(function () use ($document, $version, $counts, $add): StockDocument {
            $doc = $this->lockedDraft($document, $version);

            if ($doc->doc_type !== DocumentType::Count) {
                Messages::fail('document', 'not_a_count');
            }

            foreach ($counts as $i => $count) {
                $line = StockDocumentLine::query()->where('document_id', $doc->id)->whereKey(is_string($count['line_id'] ?? null) ? $count['line_id'] : '')->first();

                if ($line === null) {
                    Messages::fail("counts.{$i}.line_id", 'line_missing');
                }

                $counted = $count['counted_quantity'] ?? null;
                $line->counted_quantity = is_string($counted) || is_int($counted) ? Stock::dec((string) $counted) : null;
                $line->save();
            }

            $this->addCountLines($doc, $add);
            $doc->bumpVersion();
            $doc->touch();

            return $doc;
        });
    }

    /**
     * Replaces the lines of a draft.
     *
     * @param  list<mixed>  $lines
     */
    public function writeLines(StockDocument $doc, array $lines): void
    {
        if (count($lines) > StockDocument::MAX_LINES) {
            Messages::fail('lines', 'too_many_lines', ['max' => StockDocument::MAX_LINES]);
        }

        StockDocumentLine::query()->where('document_id', $doc->id)->delete();

        foreach ($lines as $i => $line) {
            $this->addLine($doc, is_array($line) ? $line : [], $i + 1, "lines.{$i}");
        }
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function addLine(StockDocument $doc, array $data, int $no, string $field, ?string $systemQuantity = null): StockDocumentLine
    {
        $item = $this->item($data['item_id'] ?? null, "{$field}.item_id");
        $unitId = is_string($data['unit_id'] ?? null) ? $data['unit_id'] : $item->baseUnitId;
        $qty = is_string($data['quantity'] ?? null) || is_int($data['quantity'] ?? null) ? (string) $data['quantity'] : '0';
        $base = $this->toBase($qty, $unitId, $item, "{$field}.unit_id");
        $location = is_string($data['location_id'] ?? null) ? $data['location_id'] : null;
        $target = is_string($data['target_location_id'] ?? null) ? $data['target_location_id'] : null;
        $lotNo = is_string($data['lot_no'] ?? null) && trim($data['lot_no']) !== '' ? trim($data['lot_no']) : null;

        if ($location !== null && ! $this->warehouses->locationBelongsTo($location, $doc->warehouse_id)) {
            Messages::fail("{$field}.location_id", 'location_invalid');
        }

        if ($target !== null && ($doc->target_warehouse_id === null || ! $this->warehouses->locationBelongsTo($target, $doc->target_warehouse_id))) {
            Messages::fail("{$field}.target_location_id", 'location_invalid');
        }

        if ($doc->doc_type === DocumentType::Count) {
            $systemQuantity ??= $this->onHand($doc, $item->id, $location, $lotNo);
        }

        $line = new StockDocumentLine([
            'line_no' => $no,
            'item_id' => $item->id,
            'unit_id' => $unitId,
            'quantity' => Stock::qty($qty),
            'base_quantity' => $base,
            'unit_cost' => isset($data['unit_cost']) && (is_string($data['unit_cost']) || is_int($data['unit_cost'])) ? (string) $data['unit_cost'] : null,
            'lot_no' => $lotNo,
            'expiry_date' => is_string($data['expiry_date'] ?? null) ? $data['expiry_date'] : null,
            'serial_numbers' => is_array($data['serial_numbers'] ?? null) ? array_values(array_map('strval', array_filter($data['serial_numbers'], 'is_scalar'))) : [],
            'location_id' => $location,
            'target_location_id' => $target,
            'direction' => $doc->doc_type === DocumentType::Adjustment ? (is_string($data['direction'] ?? null) ? $data['direction'] : 'in') : null,
            'system_quantity' => $systemQuantity,
            'counted_quantity' => $doc->doc_type === DocumentType::Count && isset($data['counted_quantity']) && (is_string($data['counted_quantity']) || is_int($data['counted_quantity'])) ? Stock::qty((string) $data['counted_quantity']) : null,
            'notes' => is_string($data['notes'] ?? null) ? $data['notes'] : null,
            'reservation_id' => $doc->doc_type === DocumentType::Issue && is_string($data['reservation_id'] ?? null) ? $data['reservation_id'] : null,
        ]);
        $line->document_id = $doc->id;
        $line->save();

        return $line;
    }

    /**
     * Snapshot of the warehouse's non-zero balances (optionally some items) as uncounted lines.
     *
     * @param  list<string>  $itemIds
     */
    private function snapshot(StockDocument $doc, array $itemIds): void
    {
        $rows = DB::table('stock_balances as b')
            ->leftJoin('stock_lots as l', 'l.id', '=', 'b.lot_id')
            ->join('items as i', 'i.id', '=', 'b.item_id')
            ->where('b.company_id', $doc->company_id)->where('b.warehouse_id', $doc->warehouse_id)->where('b.on_hand', '<>', 0)
            ->when($itemIds !== [], fn ($q) => $q->whereIn('b.item_id', $itemIds))
            ->orderBy('i.code')->orderBy('b.location_id')->orderBy('l.lot_no')
            ->get(['b.item_id', 'b.location_id', 'l.lot_no', 'b.on_hand', 'i.base_unit_id']);

        if ($rows->count() > StockDocument::MAX_LINES) {
            Messages::fail('item_ids', 'count_too_large', ['max' => StockDocument::MAX_LINES]);
        }

        $no = 1;

        foreach ($rows as $row) {
            $onHand = Stock::dec((string) $row->on_hand);
            $line = new StockDocumentLine([
                'line_no' => $no++,
                'item_id' => (string) $row->item_id,
                'unit_id' => (string) $row->base_unit_id,
                'quantity' => '0',
                'base_quantity' => '0',
                'lot_no' => is_string($row->lot_no) ? $row->lot_no : null,
                'location_id' => Stock::nullable((string) $row->location_id),
                'serial_numbers' => [],
                'system_quantity' => Stock::qty($onHand->isNegative() ? '0' : $onHand),
            ]);
            $line->document_id = $doc->id;
            $line->save();
        }
    }

    /**
     * @param  list<mixed>  $lines
     */
    private function addCountLines(StockDocument $doc, array $lines): void
    {
        $no = (int) StockDocumentLine::query()->where('document_id', $doc->id)->max('line_no');

        if ($no + count($lines) > StockDocument::MAX_LINES) {
            Messages::fail('lines', 'too_many_lines', ['max' => StockDocument::MAX_LINES]);
        }

        foreach ($lines as $i => $line) {
            $this->addLine($doc, is_array($line) ? $line : [], ++$no, "add.{$i}");
        }
    }

    private function onHand(StockDocument $doc, string $itemId, ?string $locationId, ?string $lotNo): string
    {
        $lotId = $lotNo === null ? null : DB::table('stock_lots')->where('company_id', $doc->company_id)->where('item_id', $itemId)->where('lot_no', $lotNo)->value('id');
        $value = DB::table('stock_balances')->where('company_id', $doc->company_id)->where('item_id', $itemId)->where('warehouse_id', $doc->warehouse_id)
            ->where('location_id', Stock::key($locationId))->where('lot_id', Stock::key(is_string($lotId) ? $lotId : null))->value('on_hand');
        $qty = Stock::dec(is_string($value) ? $value : '0');

        return Stock::qty($qty->isNegative() ? '0' : $qty);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function fill(StockDocument $doc, array $data): void
    {
        $doc->fill(array_intersect_key($data, array_flip(['doc_type', 'document_date', 'warehouse_id', 'target_warehouse_id', 'reason', 'notes', 'offset_event', 'allow_expired'])));

        foreach (['warehouse_id', 'target_warehouse_id'] as $field) {
            $id = $doc->getAttribute($field);

            if (is_string($id) && ($doc->isDirty($field) || ! $doc->exists)) {
                $warehouse = $this->warehouses->find($id);

                if ($warehouse === null || ! $warehouse->isActive) {
                    Messages::fail($field, 'warehouse_unavailable');
                }
            }
        }

        if ($doc->doc_type === DocumentType::Transfer && $doc->target_warehouse_id === null) {
            Messages::fail('target_warehouse_id', 'target_warehouse_required');
        }

        if ($doc->doc_type !== DocumentType::Transfer) {
            $doc->target_warehouse_id = null;
        }

        if ($doc->offset_event !== null && ! in_array($doc->offset_event, StockLedger::OFFSET_EVENTS, true)) {
            Messages::fail('offset_event', 'offset_event_invalid');
        }
    }

    private function lockedDraft(StockDocument $document, ?int $version): StockDocument
    {
        $doc = StockDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();

        if ($version !== null) {
            $doc->assertVersion($version);
        }

        if (! $doc->isDraft()) {
            Messages::fail('document', 'document_not_draft');
        }

        return $doc;
    }

    private function item(mixed $id, string $field): ItemData
    {
        $item = is_string($id) ? $this->items->find($id) : null;

        if ($item === null) {
            Messages::fail($field, 'item_missing');
        }

        if ($item->type !== 'stock') {
            Messages::fail($field, 'item_not_stocked', ['code' => $item->code]);
        }

        return $item;
    }

    private function toBase(string $qty, string $unitId, ItemData $item, string $field): string
    {
        if ($unitId === $item->baseUnitId) {
            return Stock::qty($qty);
        }

        try {
            return Stock::qty($this->units->convert($qty, $unitId, $item->baseUnitId, $item->id, Stock::QTY_SCALE));
        } catch (UnitConversionMissing) {
            Messages::fail($field, 'unit_not_convertible', ['code' => $item->code]);
        }
    }
}
