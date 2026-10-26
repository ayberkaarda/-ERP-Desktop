<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Ledger;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Numbering\NumberSequenceService;
use App\Modules\Accounting\Contracts\AccountDeterminer;
use App\Modules\Accounting\Contracts\PeriodGuard;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostingLine;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Catalog\Data\ItemData;
use App\Modules\Inventory\Enums\Direction;
use App\Modules\Inventory\Enums\DocumentStatus;
use App\Modules\Inventory\Enums\DocumentType;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Inventory\Enums\ReservationPolicy;
use App\Modules\Inventory\Enums\ReservationStatus;
use App\Modules\Inventory\Enums\SerialStatus;
use App\Modules\Inventory\Events\StockPosted;
use App\Modules\Inventory\Events\StockReversed;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\StockDocumentLine;
use App\Modules\Inventory\Services\Costing\CostBook;
use App\Modules\Inventory\Services\Costing\Valuator;
use App\Modules\Inventory\Services\WarehouseDirectory;
use App\Modules\Inventory\Support\InventorySettings;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

/**
 * Posts and reverses stock documents. One transaction per call (a savepoint inside the caller's):
 * period guard, valuation rows of the touched (item, warehouse) pairs locked in sorted order, then
 * their balance rows; allocation (FEFO for lots), costing, availability and reservation checks;
 * the journal entry through Accounting's PostingService; append-only movements, balances, layers,
 * serials; the deferred negative-stock check fired before returning; events after commit.
 */
final class StockLedger
{
    public const string SOURCE_TYPE = 'stock_document';

    /** Determination event of the stock account. */
    public const string STOCK_EVENT = 'inventory.stock';

    public const array OFFSET_EVENTS = [
        'inventory.adjustment_gain', 'inventory.adjustment_loss', 'inventory.scrap', 'inventory.opening_offset', 'inventory.cogs',
    ];

    public function __construct(
        private readonly CompanyContext $company,
        private readonly ItemLookup $items,
        private readonly WarehouseDirectory $warehouses,
        private readonly PeriodGuard $periods,
        private readonly PostingService $poster,
        private readonly AccountDeterminer $accounts,
        private readonly NumberSequenceService $numbers,
        private readonly InventorySettings $settings,
    ) {}

    public function post(StockDocument $document, PostOptions $options, ?int $version = null): StockDocument
    {
        return $this->company->runAs($document->company_id, fn (): StockDocument => Stock::transaction(function () use ($document, $options, $version): StockDocument {
            $doc = StockDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $doc->assertVersion($version);
            }

            if (! $doc->isDraft()) {
                Messages::locked();
            }

            // Judged on the locked row: a concurrent edit cannot switch the flag on after a check.
            if ($doc->allow_expired && ! $options->expiredAllowed) {
                throw new ApiException(ErrorCode::Forbidden, Messages::get('issue_expired_forbidden'));
            }

            $date = $doc->document_date->format('Y-m-d');
            $this->periods->assertOpen($doc->company_id, new DateTimeImmutable($date));
            $lines = $doc->lines()->get();

            if ($lines->isEmpty()) {
                Messages::fail('lines', 'lines_required');
            }

            if ($doc->doc_type === DocumentType::Count) {
                $this->assertUniqueCountKeys($lines->all());
            }

            $run = $this->start($doc, $date, $options->actor, $lines->all());

            foreach ($lines as $i => $line) {
                $this->planLine($run, $doc, $line, "lines.{$i}", $options);
            }

            $this->assertAvailability($run);
            $doc->number = $this->numbers->next($doc->company_id, $doc->doc_type->sequence(), $doc->doc_type->series(), (int) substr($date, 0, 4));
            $journalId = $options->postJournal ? $this->bookJournal($run, $doc, $options->actor) : null;
            $this->write($run, $journalId);

            $doc->status = DocumentStatus::Posted;
            $doc->journal_entry_id = $journalId;
            $doc->posted_at = now();
            $doc->posted_by = $options->actor;
            $doc->save();
            Stock::checkDeferred();

            event(new StockPosted($doc->company_id, $doc->id, $doc->doc_type->value, (string) $doc->number, $doc->source_type, $doc->source_id, $journalId));

            return $doc;
        }));
    }

    public function reverse(StockDocument $document, DateTimeInterface $date, string $reason, ?string $actor, ?int $version = null): StockDocument
    {
        return $this->company->runAs($document->company_id, fn (): StockDocument => Stock::transaction(function () use ($document, $date, $reason, $actor, $version): StockDocument {
            $doc = StockDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            $reason = trim($reason);

            if ($version !== null) {
                $doc->assertVersion($version);
            }

            if ($doc->status !== DocumentStatus::Posted) {
                Messages::fail('document', $doc->status === DocumentStatus::Cancelled ? 'document_already_reversed' : 'document_not_posted');
            }

            if ($reason === '' || mb_strlen($reason) > 1000) {
                Messages::fail('reason', 'reason_required');
            }

            $day = $date->format('Y-m-d');

            if ($day < $doc->document_date->format('Y-m-d')) {
                Messages::fail('date', 'reverse_before_document');
            }

            $this->periods->assertOpen($doc->company_id, new DateTimeImmutable($day));
            $originals = DB::table('stock_movements')->where('document_id', $doc->id)->whereNull('reverses_id')->orderByDesc('seq')->get();
            $run = $this->startReversal($doc, $day, $actor, $originals->all());

            foreach ($originals as $m) {
                $this->mirror($run, $m);
            }

            $this->assertAvailability($run, reversal: true);
            $journalId = $doc->journal_entry_id === null ? null : $this->poster->reverse($doc->journal_entry_id, new DateTimeImmutable($day), $reason)->id;
            $this->write($run, $journalId);

            $doc->status = DocumentStatus::Cancelled;
            $doc->reversal_date = Carbon::parse($day);
            $doc->reversal_reason = $reason;
            $doc->reversal_journal_entry_id = $journalId;
            $doc->reversed_at = now();
            $doc->reversed_by = $actor;
            $doc->save();
            Stock::checkDeferred();

            event(new StockReversed($doc->company_id, $doc->id, $doc->doc_type->value, $doc->source_type, $doc->source_id, $journalId));

            return $doc;
        }));
    }

    /**
     * @param  array<int, StockDocumentLine>  $lines
     */
    private function start(StockDocument $doc, string $date, ?string $actor, array $lines): Run
    {
        $warehouses = [];

        foreach (array_filter([$doc->warehouse_id, $doc->target_warehouse_id]) as $field => $id) {
            // Share lock: a Reference warehouse delete (row lock, movement check) cannot slip in.
            $warehouse = $this->warehouses->find($id, share: true);

            if ($warehouse === null || ! $warehouse->isActive) {
                Messages::fail($field === 0 ? 'warehouse_id' : 'target_warehouse_id', 'warehouse_unavailable');
            }

            $warehouses[$id] = $warehouse;
        }

        $items = [];
        $pairs = [];

        foreach ($lines as $i => $line) {
            $item = $items[$line->item_id] ?? $this->items->find($line->item_id);

            if ($item === null) {
                Messages::fail("lines.{$i}.item_id", 'item_missing');
            }

            if ($item->type !== 'stock') {
                Messages::fail("lines.{$i}.item_id", 'item_not_stocked', ['code' => $item->code]);
            }

            $items[$item->id] = $item;
            $pairs[] = [$item->id, $doc->warehouse_id];

            if ($doc->target_warehouse_id !== null) {
                $pairs[] = [$item->id, $doc->target_warehouse_id];
            }
        }

        $method = $this->settings->valuationMethod();
        $book = new CostBook($doc->company_id);
        $book->lock($pairs, $method);
        $balances = new Balances($doc->company_id);
        $balances->lock($pairs);

        return new Run($doc->company_id, $doc->id, $date, $actor, $book, $balances, new Valuator($method, $this->settings->costScale()), $items, $warehouses);
    }

    /**
     * @param  array<int, stdClass>  $movements
     */
    private function startReversal(StockDocument $doc, string $date, ?string $actor, array $movements): Run
    {
        $pairs = [];
        $warehouses = [];
        $layers = [];
        $ids = [];

        foreach ($movements as $m) {
            $pairs[] = [(string) $m->item_id, (string) $m->warehouse_id];
            $warehouses[(string) $m->warehouse_id] ??= $this->warehouses->find((string) $m->warehouse_id);
            $ids[] = (string) $m->id;

            if (is_string($m->cost_layer_id)) {
                $layers[] = $m->cost_layer_id;
            }
        }

        $method = $this->settings->valuationMethod();
        $book = new CostBook($doc->company_id);
        $book->lock($pairs, $method, $layers, $ids);
        $balances = new Balances($doc->company_id);
        $balances->lock($pairs);

        return new Run($doc->company_id, $doc->id, $date, $actor, $book, $balances, new Valuator($method, $this->settings->costScale()), [], array_filter($warehouses));
    }

    private function planLine(Run $run, StockDocument $doc, StockDocumentLine $line, string $field, PostOptions $options): void
    {
        $item = $run->item($line->item_id);
        $type = $doc->doc_type;

        if ($type !== DocumentType::Count && ! $line->base_quantity->isPositive()) {
            Messages::fail("{$field}.quantity", 'quantity_positive');
        }

        $offset = $options->offsetEvent ?? $doc->offset_event;

        switch ($type) {
            case DocumentType::Receipt:
            case DocumentType::Opening:
                $movement = $options->movementType ?? ($type === DocumentType::Opening ? MovementType::Opening : MovementType::Receipt);
                $this->assertDirection($movement, Direction::In);

                if ($type === DocumentType::Opening && $line->unit_cost === null) {
                    Messages::fail("{$field}.unit_cost", 'unit_cost_required');
                }

                $this->inbound($run, $line, $item, $doc->warehouse_id, $line->location_id, $line->base_quantity, $line->unit_cost, $movement,
                    $offset ?? ($type === DocumentType::Opening ? 'inventory.opening_offset' : 'inventory.adjustment_gain'), $field);
                break;

            case DocumentType::Issue:
                $movement = $options->movementType ?? ($offset === 'inventory.scrap' ? MovementType::Scrap : MovementType::Issue);
                $this->assertDirection($movement, Direction::Out);
                $reservedLot = $this->consumeReservation($run, $line, $doc->warehouse_id, $field);
                $this->outbound($run, $doc, $line, $item, $line->base_quantity, $movement,
                    $offset ?? ($movement === MovementType::Scrap ? 'inventory.scrap' : 'inventory.cogs'), $field, $reservedLot);
                break;

            case DocumentType::Adjustment:
                if (($line->direction ?? Direction::In->value) === Direction::Out->value) {
                    $this->outbound($run, $doc, $line, $item, $line->base_quantity, MovementType::CountAdjustment, 'inventory.adjustment_loss', $field);
                } else {
                    $this->inbound($run, $line, $item, $doc->warehouse_id, $line->location_id, $line->base_quantity, $line->unit_cost, MovementType::CountAdjustment, 'inventory.adjustment_gain', $field);
                }
                break;

            case DocumentType::Count:
                $this->countLine($run, $doc, $line, $item, $field);
                break;

            case DocumentType::Transfer:
                $this->transfer($run, $doc, $line, $item, $field);
                break;
        }
    }

    /**
     * A count posts each balance key once (two lines for one key would apply the variance twice).
     *
     * @param  array<int, StockDocumentLine>  $lines
     */
    private function assertUniqueCountKeys(array $lines): void
    {
        $seen = [];

        foreach ($lines as $i => $line) {
            $key = $line->item_id.'|'.($line->location_id ?? '').'|'.($line->lot_no ?? '');

            if (isset($seen[$key])) {
                Messages::fail("lines.{$i}.item_id", 'count_line_duplicate');
            }

            $seen[$key] = true;
        }
    }

    private function assertDirection(MovementType $type, Direction $direction): void
    {
        $in = [MovementType::Receipt, MovementType::Opening, MovementType::ReturnIn, MovementType::ProductionIn];
        $out = [MovementType::Issue, MovementType::ReturnOut, MovementType::ProductionOut, MovementType::Scrap];

        if (! in_array($type, $direction === Direction::In ? $in : $out, true)) {
            Messages::fail('movement_type', 'movement_type_invalid');
        }
    }

    /**
     * @return list<array{qty: BigDecimal, unit_cost: BigDecimal, total_cost: BigDecimal, received_at: string|null, location: string|null, lot: string|null, serial: string|null}>
     */
    private function inbound(Run $run, StockDocumentLine $line, ItemData $item, string $warehouseId, ?string $locationId, BigDecimal $qty, ?BigDecimal $unitCost, MovementType $type, ?string $offset, string $field, ?BigDecimal $totalCost = null, ?string $receivedAt = null): array
    {
        $this->assertLocation($locationId, $warehouseId, "{$field}.location_id");
        $lotId = $this->inboundLot($run, $item, $line, $field);
        $pair = $run->book->pair($item->id, $warehouseId);
        $receivedAt ??= $run->date;
        $result = [];

        if ($item->tracking === 'serial') {
            $serials = $this->serialList($line, $qty, $field);
            $perUnit = $totalCost === null ? null : Stock::money($totalCost->dividedBy(count($serials), 4, RoundingMode::HalfEven));

            foreach ($serials as $n => $serialNo) {
                $serialId = $this->serialIn($run, $item, $serialNo, $warehouseId, $locationId, $lotId, "{$field}.serial_numbers.{$n}");
                $movementId = (string) Str::uuid7();
                $unitTotal = $perUnit;

                if ($totalCost !== null && $n === count($serials) - 1) {
                    $unitTotal = $totalCost->minus($perUnit?->multipliedBy(count($serials) - 1) ?? BigDecimal::zero());
                }

                $c = $run->valuator->inbound($pair, BigDecimal::one(), $unitCost, $unitTotal, $receivedAt, $movementId);
                $run->movement($item->id, $warehouseId, $locationId, $lotId, $serialId, $type, Direction::In, BigDecimal::one(), $c['unit_cost'], $c['total_cost'], $line->id, id: $movementId);
                $run->balances->add($item->id, $warehouseId, $locationId, $lotId, BigDecimal::one());
                $run->addJournal(Direction::In, $offset, $c['total_cost'], $item->id, $warehouseId);
                $result[] = ['qty' => BigDecimal::one(), 'unit_cost' => $c['unit_cost'], 'total_cost' => $c['total_cost'], 'received_at' => $receivedAt, 'location' => $locationId, 'lot' => $lotId, 'serial' => $serialId];
            }

            return $result;
        }

        $movementId = (string) Str::uuid7();
        $c = $run->valuator->inbound($pair, $qty, $unitCost, $totalCost, $receivedAt, $movementId);
        $run->movement($item->id, $warehouseId, $locationId, $lotId, null, $type, Direction::In, $qty, $c['unit_cost'], $c['total_cost'], $line->id, id: $movementId);
        $run->balances->add($item->id, $warehouseId, $locationId, $lotId, $qty);
        $run->addJournal(Direction::In, $offset, $c['total_cost'], $item->id, $warehouseId);

        return [['qty' => $qty, 'unit_cost' => $c['unit_cost'], 'total_cost' => $c['total_cost'], 'received_at' => $receivedAt, 'location' => $locationId, 'lot' => $lotId, 'serial' => null]];
    }

    /**
     * Allocates and costs an outbound quantity of the document's warehouse.
     *
     * @return list<array{qty: BigDecimal, unit_cost: BigDecimal, total_cost: BigDecimal, received_at: string|null, location: string|null, lot: string|null, serial: string|null}>
     */
    private function outbound(Run $run, StockDocument $doc, StockDocumentLine $line, ItemData $item, BigDecimal $qty, MovementType $type, ?string $offset, string $field, ?string $reservedLot = null): array
    {
        $warehouseId = $doc->warehouse_id;
        $this->assertLocation($line->location_id, $warehouseId, "{$field}.location_id");
        $pair = $run->book->pair($item->id, $warehouseId);
        $result = [];

        if ($item->tracking === 'serial') {
            $serials = $this->serialList($line, $qty, $field);
            $leaving = $type === MovementType::Scrap ? SerialStatus::Scrapped : SerialStatus::Issued;

            foreach ($serials as $n => $serialNo) {
                [$serialId, $location, $lot] = $this->serialOut($run, $item, $serialNo, $warehouseId, $line->location_id, $leaving, "{$field}.serial_numbers.{$n}");
                $this->assertNotExpired($run, $lot, $doc->allow_expired, "{$field}.serial_numbers.{$n}");

                if ($reservedLot !== null && $lot !== $reservedLot) {
                    Messages::fail("{$field}.serial_numbers.{$n}", 'reservation_lot_mismatch');
                }

                $portions = $run->valuator->outbound($pair, BigDecimal::one());
                $total = BigDecimal::zero();

                foreach ($portions as $p) {
                    $total = $total->plus($p['total_cost']);
                }

                $unit = $total->toScale(6);
                $layer = $portions[0]['layer_id'] ?? null;
                $run->movement($item->id, $warehouseId, $location, $lot, $serialId, $type, Direction::Out, BigDecimal::one(), $unit, $total, $line->id, $layer);
                $run->balances->add($item->id, $warehouseId, $location, $lot, BigDecimal::one()->negated());
                $run->addJournal(Direction::Out, $offset, $total, $item->id, $warehouseId);
                $result[] = ['qty' => BigDecimal::one(), 'unit_cost' => $unit, 'total_cost' => $total, 'received_at' => $portions[0]['received_at'] ?? null, 'location' => $location, 'lot' => $lot, 'serial' => $serialId];
            }

            return $result;
        }

        foreach ($this->allocate($run, $doc, $line, $item, $qty, $field, $reservedLot) as $a) {
            foreach ($run->valuator->outbound($pair, $a['qty']) as $p) {
                $run->movement($item->id, $warehouseId, $a['location'], $a['lot'], null, $type, Direction::Out, $p['qty'], $p['unit_cost'], $p['total_cost'], $line->id, $p['layer_id']);
                $run->balances->add($item->id, $warehouseId, $a['location'], $a['lot'], $p['qty']->negated());
                $run->addJournal(Direction::Out, $offset, $p['total_cost'], $item->id, $warehouseId);
                $result[] = ['qty' => $p['qty'], 'unit_cost' => $p['unit_cost'], 'total_cost' => $p['total_cost'], 'received_at' => $p['received_at'], 'location' => $a['location'], 'lot' => $a['lot'], 'serial' => null];
            }
        }

        return $result;
    }

    /**
     * Where an outbound quantity comes from: the named location and/or lot, otherwise FEFO over the
     * lots (earliest expiry first, expired lots skipped unless allowed) or the rows of the warehouse
     * (no location first). A remainder goes negative only where the warehouse allows it. A consumed
     * reservation of one lot pins the line to that lot; under a hard policy FEFO skips stock that
     * lot reservations hold.
     *
     * @return list<array{qty: BigDecimal, location: string|null, lot: string|null}>
     */
    private function allocate(Run $run, StockDocument $doc, StockDocumentLine $line, ItemData $item, BigDecimal $qty, string $field, ?string $reservedLot = null): array
    {
        $warehouse = $run->warehouse($doc->warehouse_id);
        $lotTracked = $item->tracking === 'lot' || $item->hasExpiry;
        $lotId = null;

        if ($line->lot_no !== null && $line->lot_no !== '') {
            $lotId = $this->existingLot($item, $line->lot_no, "{$field}.lot_no");

            if ($reservedLot !== null && $lotId !== $reservedLot) {
                Messages::fail("{$field}.lot_no", 'reservation_lot_mismatch');
            }
        } elseif ($reservedLot !== null) {
            $lotId = $reservedLot;
        }

        if ($lotId !== null) {
            $this->assertNotExpired($run, $lotId, $doc->allow_expired, "{$field}.lot_no");
        }

        $fefo = $lotTracked && $lotId === null;
        $free = [];

        if ($fefo && $warehouse->reservationPolicy === ReservationPolicy::Hard) {
            foreach ($run->balances->lotTotals($item->id, $doc->warehouse_id) as $lot => [$lotOnHand, $lotReserved]) {
                $free[$lot] = $lotOnHand->minus($lotReserved);
            }
        }
        $candidates = $run->balances->positive($item->id, $doc->warehouse_id, $line->location_id, $lotId, anyLot: $fefo);
        $expiry = $fefo ? $this->lotExpiries(array_column($candidates, 'lot')) : [];

        usort($candidates, static function (array $a, array $b) use ($expiry): int {
            $ea = $expiry[$a['lot']]['expiry'] ?? '9999-12-31';
            $eb = $expiry[$b['lot']]['expiry'] ?? '9999-12-31';

            return [$ea, $expiry[$a['lot']]['lot_no'] ?? '', $a['location'] === Stock::NIL ? '' : $a['location']]
                <=> [$eb, $expiry[$b['lot']]['lot_no'] ?? '', $b['location'] === Stock::NIL ? '' : $b['location']];
        });

        $remaining = $qty;
        $allocations = [];
        $skippedExpired = false;

        foreach ($candidates as $c) {
            if (! $remaining->isPositive()) {
                break;
            }

            if ($fefo && ! $doc->allow_expired && isset($expiry[$c['lot']]['expiry']) && $expiry[$c['lot']]['expiry'] < $run->date) {
                $skippedExpired = true;

                continue;
            }

            $take = $remaining->isLessThan($c['on_hand']) ? $remaining : $c['on_hand'];

            if (isset($free[$c['lot']])) {
                $take = $take->isGreaterThan($free[$c['lot']]) ? $free[$c['lot']] : $take;

                if (! $take->isPositive()) {
                    continue;
                }

                $free[$c['lot']] = $free[$c['lot']]->minus($take);
            }

            $allocations[] = ['qty' => $take, 'location' => Stock::nullable($c['location']), 'lot' => Stock::nullable($c['lot'])];
            $remaining = $remaining->minus($take);
        }

        if ($remaining->isPositive()) {
            if ($fefo || ! $warehouse->allowNegativeStock) {
                [$onHand] = $run->balances->totals($item->id, $doc->warehouse_id);
                Messages::fail("{$field}.quantity", $skippedExpired ? 'insufficient_unexpired_stock' : 'insufficient_stock', [
                    'item' => $item->code, 'warehouse' => $warehouse->code, 'available' => Stock::qty($onHand),
                ]);
            }

            $allocations[] = ['qty' => $remaining, 'location' => $line->location_id, 'lot' => $lotId];
        }

        return $allocations;
    }

    private function transfer(Run $run, StockDocument $doc, StockDocumentLine $line, ItemData $item, string $field): void
    {
        $target = (string) $doc->target_warehouse_id;

        if ($target === $doc->warehouse_id && $line->target_location_id === $line->location_id) {
            Messages::fail("{$field}.target_location_id", 'transfer_same_place');
        }

        $this->assertLocation($line->target_location_id, $target, "{$field}.target_location_id");
        $portions = $this->outbound($run, $doc, $line, $item, $line->base_quantity, MovementType::TransferOut, null, $field);
        $pair = $run->book->pair($item->id, $target);

        foreach ($portions as $p) {
            $movementId = (string) Str::uuid7();
            $c = $run->valuator->inbound($pair, $p['qty'], $p['unit_cost'], $p['total_cost'], $p['received_at'] ?? $run->date, $movementId);
            $run->movement($item->id, $target, $line->target_location_id, $p['lot'], $p['serial'], MovementType::TransferIn, Direction::In, $p['qty'], $c['unit_cost'], $c['total_cost'], $line->id, id: $movementId);
            $run->balances->add($item->id, $target, $line->target_location_id, $p['lot'], $p['qty']);

            if ($p['serial'] !== null) {
                $run->serials[$p['serial']] = [...$this->serialState($run, $p['serial']), 'status' => SerialStatus::InStock, 'warehouse' => $target, 'location' => $line->target_location_id];
            }
        }
    }

    private function countLine(Run $run, StockDocument $doc, StockDocumentLine $line, ItemData $item, string $field): void
    {
        if ($line->counted_quantity === null) {
            return;
        }

        if ($item->tracking === 'serial') {
            Messages::fail("{$field}.item_id", 'count_serial_unsupported', ['code' => $item->code]);
        }

        $diff = $line->counted_quantity->minus($line->system_quantity ?? BigDecimal::zero());

        if ($diff->isZero()) {
            return;
        }

        if ($diff->isPositive()) {
            $this->inbound($run, $line, $item, $doc->warehouse_id, $line->location_id, $diff, $line->unit_cost, MovementType::CountAdjustment, 'inventory.adjustment_gain', $field);

            return;
        }

        $this->assertLocation($line->location_id, $doc->warehouse_id, "{$field}.location_id");
        $lotId = $line->lot_no !== null && $line->lot_no !== '' ? $this->existingLot($item, $line->lot_no, "{$field}.lot_no") : null;
        $qty = $diff->negated();
        $pair = $run->book->pair($item->id, $doc->warehouse_id);

        foreach ($run->valuator->outbound($pair, $qty) as $p) {
            $run->movement($item->id, $doc->warehouse_id, $line->location_id, $lotId, null, MovementType::CountAdjustment, Direction::Out, $p['qty'], $p['unit_cost'], $p['total_cost'], $line->id, $p['layer_id']);
            $run->balances->add($item->id, $doc->warehouse_id, $line->location_id, $lotId, $p['qty']->negated());
            $run->addJournal(Direction::Out, 'inventory.adjustment_loss', $p['total_cost'], $item->id, $doc->warehouse_id);
        }
    }

    /** Releases the reservation an issue line consumes, before availability is judged. */
    /**
     * Consumes the issued quantity of the reservation an issue line names (the rest stays held) and
     * returns the lot the reservation holds, which the line must then issue from.
     */
    private function consumeReservation(Run $run, StockDocumentLine $line, string $warehouseId, string $field): ?string
    {
        if ($line->reservation_id === null) {
            return null;
        }

        $reservation = DB::table('stock_reservations')->where('id', $line->reservation_id)->where('company_id', $run->companyId)->lockForUpdate()->first();

        if ($reservation === null || $reservation->status !== ReservationStatus::Active->value
            || $reservation->item_id !== $line->item_id || $reservation->warehouse_id !== $warehouseId) {
            Messages::fail("{$field}.reservation_id", 'reservation_not_usable');
        }

        $lot = is_string($reservation->lot_id) ? $reservation->lot_id : null;
        $held = Stock::dec((string) $reservation->quantity);
        $used = $line->base_quantity->isLessThan($held) ? $line->base_quantity : $held;
        $rest = $held->minus($used);
        $run->balances->add($line->item_id, $warehouseId, null, $lot, BigDecimal::zero(), $used->negated());
        DB::table('stock_reservations')->where('id', $reservation->id)->update($rest->isPositive()
            ? ['quantity' => Stock::qty($rest), 'version' => DB::raw('version + 1'), 'updated_at' => now()]
            : ['status' => ReservationStatus::Consumed->value, 'closed_at' => now(), 'version' => DB::raw('version + 1'), 'updated_at' => now()]);

        return $lot;
    }

    /**
     * Mirrors one original movement: opposite direction, same quantity and cost.
     */
    private function mirror(Run $run, stdClass $m): void
    {
        $id = (string) $m->id;
        $item = (string) $m->item_id;
        $warehouse = (string) $m->warehouse_id;
        $location = is_string($m->location_id) ? $m->location_id : null;
        $lot = is_string($m->lot_id) ? $m->lot_id : null;
        $serial = is_string($m->serial_id) ? $m->serial_id : null;
        $qty = Stock::dec((string) $m->quantity);
        $total = Stock::dec((string) $m->total_cost);
        $unit = Stock::dec((string) $m->unit_cost);
        $pair = $run->book->pair($item, $warehouse);
        $type = MovementType::from((string) $m->movement_type);
        $layer = null;
        $mirrorId = (string) Str::uuid7();

        if ($m->direction === Direction::In->value) {
            $run->valuator->reverseInbound($pair, $id, $qty, $total, 'document');
            $run->balances->add($item, $warehouse, $location, $lot, $qty->negated());
            $direction = Direction::Out;

            if ($serial !== null) {
                $state = $this->serialState($run, $serial);

                if ($state['status'] !== SerialStatus::InStock || $state['warehouse'] !== $warehouse) {
                    Messages::fail('document', 'reverse_serial_consumed', ['serial' => $state['serial_no']]);
                }

                $run->serials[$serial] = [...$state, 'status' => SerialStatus::Issued, 'warehouse' => null, 'location' => null];
            }
        } else {
            // A FIFO portion without a layer (negative stock) comes back as a new layer of the mirror.
            $layer = is_string($m->cost_layer_id) ? $m->cost_layer_id : null;
            $layer = $run->valuator->reverseOutbound($pair, $layer, $qty, $total, $unit, (string) $m->occurred_at, $mirrorId) ?? $layer;
            $run->balances->add($item, $warehouse, $location, $lot, $qty);
            $direction = Direction::In;

            if ($serial !== null) {
                $state = $this->serialState($run, $serial);

                if (! in_array($state['status'], [SerialStatus::Issued, SerialStatus::Scrapped], true)) {
                    Messages::fail('document', 'reverse_serial_consumed', ['serial' => $state['serial_no']]);
                }

                $run->serials[$serial] = [...$state, 'status' => SerialStatus::InStock, 'warehouse' => $warehouse, 'location' => $location];
            }
        }

        $run->movement($item, $warehouse, $location, $lot, $serial, $type, $direction, $qty, $unit, $total, is_string($m->document_line_id) ? $m->document_line_id : null, $layer, $id, $mirrorId);
    }

    /**
     * Negative stock only where the warehouse allows it; under a hard reservation policy, issues may
     * not take stock held for others.
     */
    private function assertAvailability(Run $run, bool $reversal = false): void
    {
        foreach ($run->balances->newlyNegative() as $row) {
            $warehouse = $run->warehouses[$row['warehouse']] ?? null;

            if ($warehouse === null || ! $warehouse->allowNegativeStock) {
                $item = $run->items[$row['item']] ?? $this->items->find($row['item']);
                Messages::fail($reversal ? 'document' : 'lines', $reversal ? 'reverse_negative_stock' : 'insufficient_stock', [
                    'item' => $item->code ?? $row['item'], 'warehouse' => $warehouse->code ?? $row['warehouse'], 'available' => '0',
                ]);
            }
        }

        foreach ($run->balances->decreasedPairs() as [$itemId, $warehouseId]) {
            $warehouse = $run->warehouses[$warehouseId] ?? null;

            if ($warehouse === null || $warehouse->reservationPolicy->value !== 'hard') {
                continue;
            }

            [$onHand, $reserved] = $run->balances->totals($itemId, $warehouseId);
            $short = $reserved->isPositive() && $onHand->isLessThan($reserved);

            // A lot reservation holds that lot: other lots cannot stand in for it.
            foreach ($run->balances->lotTotals($itemId, $warehouseId) as [$lotOnHand, $lotReserved]) {
                $short = $short || ($lotReserved->isPositive() && $lotOnHand->isLessThan($lotReserved));
            }

            if ($short) {
                $item = $run->items[$itemId] ?? $this->items->find($itemId);
                Messages::fail($reversal ? 'document' : 'lines', 'reserved_stock', ['item' => $item->code ?? $itemId, 'reserved' => Stock::qty($reserved)]);
            }
        }
    }

    /**
     * Books the document's financial effect: Dr stock / Cr offset for inbound, the mirror for
     * outbound, aggregated per account and side.
     */
    private function bookJournal(Run $run, StockDocument $doc, ?string $actor): ?string
    {
        $sides = [];

        foreach ($run->journal as $j) {
            $item = $run->item($j['item']);
            $context = ['item_id' => $item->id, 'item_category' => $item->categoryId, 'warehouse_id' => $j['warehouse']];
            $stock = $this->accounts->resolve(self::STOCK_EVENT, $context)->id;
            $offset = $this->accounts->resolve($j['offset'], $context)->id;
            [$debit, $credit] = $j['direction'] === Direction::In ? [$stock, $offset] : [$offset, $stock];
            $sides['d|'.$debit] = ($sides['d|'.$debit] ?? BigDecimal::zero())->plus($j['amount']);
            $sides['c|'.$credit] = ($sides['c|'.$credit] ?? BigDecimal::zero())->plus($j['amount']);
        }

        if ($sides === []) {
            return null;
        }

        $lines = [];

        foreach ($sides as $key => $amount) {
            [$side, $account] = explode('|', $key, 2);
            $lines[] = $side === 'd'
                ? PostingLine::debit($account, (string) Stock::money($amount), ['documentRef' => $doc->number])
                : PostingLine::credit($account, (string) Stock::money($amount), ['documentRef' => $doc->number]);
        }

        return $this->poster->post(new PostingRequest(
            $doc->company_id,
            new DateTimeImmutable($run->date),
            EntryType::System,
            trim(Messages::get('journal_description', ['number' => (string) $doc->number]).' '.($doc->reason ?? '')),
            self::SOURCE_TYPE,
            $doc->id,
            $lines,
            'main',
            $actor,
        ))->id;
    }

    private function write(Run $run, ?string $journalId): void
    {
        $this->writeSerials($run);
        $rows = array_map(static fn (array $m): array => [...$m, 'journal_entry_id' => $journalId], $run->movements);

        foreach (array_chunk($rows, 250) as $chunk) {
            DB::table('stock_movements')->insert($chunk);
        }

        $run->balances->persist();
        $run->book->persist();
    }

    private function writeSerials(Run $run): void
    {
        foreach ($run->serials as $id => $state) {
            if (isset($run->newSerials[$id])) {
                continue;
            }

            DB::table('stock_serials')->where('id', $id)->update([
                'status' => $state['status']->value, 'warehouse_id' => $state['warehouse'], 'location_id' => $state['location'], 'lot_id' => $state['lot'], 'updated_at' => now(),
            ]);
        }
    }

    private function assertLocation(?string $locationId, string $warehouseId, string $field): void
    {
        if ($locationId !== null && ! $this->warehouses->locationBelongsTo($locationId, $warehouseId)) {
            Messages::fail($field, 'location_invalid');
        }
    }

    /** The lot of an inbound line, created on first use; expiry required for has_expiry items. */
    private function inboundLot(Run $run, ItemData $item, StockDocumentLine $line, string $field): ?string
    {
        $lotNo = $line->lot_no !== null ? trim($line->lot_no) : '';
        $expiry = $line->expiry_date?->format('Y-m-d');

        if ($lotNo === '') {
            if ($item->tracking === 'lot' || $item->hasExpiry) {
                Messages::fail("{$field}.lot_no", 'lot_required', ['code' => $item->code]);
            }

            return null;
        }

        DB::table('stock_lots')->insertOrIgnore([
            'id' => (string) Str::uuid7(), 'company_id' => $run->companyId, 'item_id' => $item->id, 'lot_no' => $lotNo,
            'expiry_date' => $expiry, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $lot = DB::table('stock_lots')->where('company_id', $run->companyId)->where('item_id', $item->id)->where('lot_no', $lotNo)->first(['id', 'expiry_date']);

        if ($lot === null) {
            Messages::fail("{$field}.lot_no", 'lot_unknown', ['lot' => $lotNo]);
        }

        $stored = is_string($lot->expiry_date) ? $lot->expiry_date : null;

        if ($expiry !== null && $stored !== null && $stored !== $expiry) {
            Messages::fail("{$field}.expiry_date", 'lot_expiry_mismatch', ['lot' => $lotNo, 'expiry' => $stored]);
        }

        if ($expiry !== null && $stored === null) {
            DB::table('stock_lots')->where('id', $lot->id)->update(['expiry_date' => $expiry, 'updated_at' => now()]);
            $stored = $expiry;
        }

        if ($item->hasExpiry && $stored === null) {
            Messages::fail("{$field}.expiry_date", 'expiry_required', ['code' => $item->code]);
        }

        return (string) $lot->id;
    }

    private function existingLot(ItemData $item, string $lotNo, string $field): string
    {
        $id = DB::table('stock_lots')->where('company_id', $this->company->id())->where('item_id', $item->id)->where('lot_no', trim($lotNo))->value('id');

        if (! is_string($id)) {
            Messages::fail($field, 'lot_unknown', ['lot' => $lotNo]);
        }

        return $id;
    }

    private function assertNotExpired(Run $run, ?string $lotId, bool $allowExpired, string $field): void
    {
        if ($lotId === null || $allowExpired) {
            return;
        }

        $lot = $this->lotExpiries([$lotId])[$lotId] ?? null;

        if ($lot !== null && $lot['expiry'] !== null && $lot['expiry'] < $run->date) {
            Messages::fail($field, 'lot_expired', ['lot' => $lot['lot_no'], 'expiry' => $lot['expiry']]);
        }
    }

    /**
     * @param  list<string>  $lotIds
     * @return array<string, array{expiry: string|null, lot_no: string}>
     */
    private function lotExpiries(array $lotIds): array
    {
        $ids = array_values(array_filter(array_unique($lotIds), static fn (string $id): bool => $id !== Stock::NIL));

        if ($ids === []) {
            return [];
        }

        $map = [];

        foreach (DB::table('stock_lots')->whereIn('id', $ids)->get(['id', 'lot_no', 'expiry_date']) as $lot) {
            $map[(string) $lot->id] = ['expiry' => is_string($lot->expiry_date) ? $lot->expiry_date : null, 'lot_no' => (string) $lot->lot_no];
        }

        return $map;
    }

    /**
     * Serial numbers of a serial-tracked line: one per unit, unique.
     *
     * @return list<string>
     */
    private function serialList(StockDocumentLine $line, BigDecimal $qty, string $field): array
    {
        $serials = array_map(static fn (string $s): string => trim($s), $line->serial_numbers);

        if (! $qty->isEqualTo($qty->toScale(0, RoundingMode::Down)) || ! $qty->isEqualTo(count($serials))) {
            Messages::fail("{$field}.serial_numbers", 'serial_count_mismatch', ['count' => count($serials), 'quantity' => Stock::qty($qty)]);
        }

        if (in_array('', $serials, true) || count(array_unique($serials)) !== count($serials)) {
            Messages::fail("{$field}.serial_numbers", 'serial_duplicate');
        }

        return $serials;
    }

    private function serialIn(Run $run, ItemData $item, string $serialNo, string $warehouseId, ?string $locationId, ?string $lotId, string $field): string
    {
        $row = DB::table('stock_serials')->where('company_id', $run->companyId)->where('item_id', $item->id)->where('serial_no', $serialNo)->lockForUpdate()->first();

        if ($row === null) {
            $id = (string) Str::uuid7();
            DB::table('stock_serials')->insert([
                'id' => $id, 'company_id' => $run->companyId, 'item_id' => $item->id, 'serial_no' => $serialNo, 'lot_id' => $lotId,
                'status' => SerialStatus::InStock->value, 'warehouse_id' => $warehouseId, 'location_id' => $locationId, 'created_at' => now(), 'updated_at' => now(),
            ]);
            $run->newSerials[$id] = true;
            $run->serials[$id] = ['status' => SerialStatus::InStock, 'warehouse' => $warehouseId, 'location' => $locationId, 'lot' => $lotId, 'serial_no' => $serialNo, 'item' => $item->id];

            return $id;
        }

        $id = (string) $row->id;
        $state = $this->serialState($run, $id);

        if (! in_array($state['status'], [SerialStatus::Issued, SerialStatus::Scrapped], true)) {
            Messages::fail($field, 'serial_in_stock', ['serial' => $serialNo]);
        }

        unset($run->newSerials[$id]);
        // A returned unit takes the lot it comes back in, so its next issue debits that lot.
        $run->serials[$id] = [...$state, 'status' => SerialStatus::InStock, 'warehouse' => $warehouseId, 'location' => $locationId, 'lot' => $lotId];

        return $id;
    }

    /**
     * @return array{0: string, 1: string|null, 2: string|null} serial id, its location, its lot
     */
    private function serialOut(Run $run, ItemData $item, string $serialNo, string $warehouseId, ?string $locationId, SerialStatus $leaving, string $field): array
    {
        $row = DB::table('stock_serials')->where('company_id', $run->companyId)->where('item_id', $item->id)->where('serial_no', $serialNo)->lockForUpdate()->first();

        if ($row === null) {
            Messages::fail($field, 'serial_unknown', ['serial' => $serialNo]);
        }

        $id = (string) $row->id;
        $state = $this->serialState($run, $id);

        if ($state['status'] !== SerialStatus::InStock || $state['warehouse'] !== $warehouseId || ($locationId !== null && $state['location'] !== $locationId)) {
            Messages::fail($field, 'serial_not_available', ['serial' => $serialNo]);
        }

        if (isset($run->newSerials[$id])) {
            // Created by this posting: written as a regular update from now on.
            unset($run->newSerials[$id]);
        }

        $run->serials[$id] = [...$state, 'status' => $leaving, 'warehouse' => null, 'location' => null];

        return [$id, $state['location'], $state['lot']];
    }

    /**
     * @return array{status: SerialStatus, warehouse: string|null, location: string|null, lot: string|null, serial_no: string, item: string}
     */
    private function serialState(Run $run, string $id): array
    {
        if (isset($run->serials[$id])) {
            return $run->serials[$id];
        }

        $row = DB::table('stock_serials')->where('id', $id)->lockForUpdate()->first();

        if ($row === null) {
            throw new \LogicException('Serial missing: '.$id);
        }

        return $run->serials[$id] = [
            'status' => SerialStatus::from((string) $row->status),
            'warehouse' => is_string($row->warehouse_id) ? $row->warehouse_id : null,
            'location' => is_string($row->location_id) ? $row->location_id : null,
            'lot' => is_string($row->lot_id) ? $row->lot_id : null,
            'serial_no' => (string) $row->serial_no,
            'item' => (string) $row->item_id,
        ];
    }
}
