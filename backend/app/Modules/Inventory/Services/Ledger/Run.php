<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Ledger;

use App\Modules\Catalog\Data\ItemData;
use App\Modules\Inventory\Data\WarehouseData;
use App\Modules\Inventory\Enums\Direction;
use App\Modules\Inventory\Enums\MovementType;
use App\Modules\Inventory\Enums\SerialStatus;
use App\Modules\Inventory\Services\Costing\CostBook;
use App\Modules\Inventory\Services\Costing\Valuator;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Illuminate\Support\Str;

/**
 * Working state of one posting or reversal: locked valuation and balance rows, the movements and
 * journal amounts collected so far and the final state of every serial touched.
 */
final class Run
{
    /** @var list<array<string, mixed>> */
    public array $movements = [];

    /** @var list<array{direction: Direction, offset: string, amount: BigDecimal, item: string, warehouse: string}> */
    public array $journal = [];

    /** @var array<string, array{status: SerialStatus, warehouse: string|null, location: string|null, lot: string|null, serial_no: string, item: string}> */
    public array $serials = [];

    /** @var array<string, true> */
    public array $newSerials = [];

    /**
     * @param  array<string, ItemData>  $items
     * @param  array<string, WarehouseData>  $warehouses
     */
    public function __construct(
        public readonly string $companyId,
        public readonly string $documentId,
        public readonly string $date,
        public readonly ?string $actor,
        public readonly CostBook $book,
        public readonly Balances $balances,
        public readonly Valuator $valuator,
        public array $items = [],
        public array $warehouses = [],
    ) {}

    public function item(string $id): ItemData
    {
        return $this->items[$id] ?? throw new \LogicException('Item not loaded: '.$id);
    }

    public function warehouse(string $id): WarehouseData
    {
        return $this->warehouses[$id] ?? throw new \LogicException('Warehouse not loaded: '.$id);
    }

    /**
     * Records a movement row (inserted later, in this order) and returns its id.
     */
    public function movement(
        string $itemId,
        string $warehouseId,
        ?string $locationId,
        ?string $lotId,
        ?string $serialId,
        MovementType $type,
        Direction $direction,
        BigDecimal $qty,
        BigDecimal $unitCost,
        BigDecimal $totalCost,
        ?string $lineId,
        ?string $layerId = null,
        ?string $reversesId = null,
        ?string $id = null,
    ): string {
        $id ??= (string) Str::uuid7();
        $this->movements[] = [
            'id' => $id,
            'company_id' => $this->companyId,
            'item_id' => $itemId,
            'warehouse_id' => $warehouseId,
            'location_id' => Stock::nullable($locationId),
            'lot_id' => Stock::nullable($lotId),
            'serial_id' => $serialId,
            'movement_type' => $type->value,
            'direction' => $direction->value,
            'quantity' => Stock::qty($qty),
            'unit_cost' => (string) $unitCost,
            'total_cost' => (string) Stock::money($totalCost),
            'occurred_at' => $this->date,
            'document_type' => 'stock_document',
            'document_id' => $this->documentId,
            'document_line_id' => $lineId,
            'journal_entry_id' => null,
            'reverses_id' => $reversesId,
            'cost_layer_id' => $layerId,
            'created_by' => $this->actor,
            'created_at' => now(),
        ];

        return $id;
    }

    public function addJournal(Direction $direction, ?string $offset, BigDecimal $amount, string $itemId, string $warehouseId): void
    {
        if ($offset === null || ! $amount->isPositive()) {
            return;
        }

        $this->journal[] = ['direction' => $direction, 'offset' => $offset, 'amount' => $amount, 'item' => $itemId, 'warehouse' => $warehouseId];
    }
}
