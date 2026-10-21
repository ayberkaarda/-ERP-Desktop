<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Building blocks of the stock reports. Every figure is reconstructed from the append-only
 * stock_movements (signed quantity and booked total_cost), never read from the maintained balances,
 * so a report "as of" any date agrees with the balances for today. Names of items, warehouses and
 * categories come in one bulk query per kind (Catalog and Reference tables by column name only).
 */
final class ReportQuery
{
    public const string SIGNED_QTY = "CASE WHEN m.direction = 'in' THEN m.quantity ELSE -m.quantity END";

    public const string SIGNED_VALUE = "CASE WHEN m.direction = 'in' THEN m.total_cost ELSE -m.total_cost END";

    /** Outbound types that consume stock (cost of goods): issues and production use. */
    public const array CONSUMPTION_TYPES = ['issue', 'production_out'];

    /**
     * Movements of the company narrowed by the filters (alias m; items as i when needed).
     */
    public function movements(ReportFilters $f): Builder
    {
        $query = DB::table('stock_movements as m')->where('m.company_id', $f->companyId);

        if ($f->warehouseId !== null) {
            $query->where('m.warehouse_id', $f->warehouseId);
        }

        if ($f->itemId !== null) {
            $query->where('m.item_id', $f->itemId);
        }

        if ($f->needsItems()) {
            $query->join('items as i', fn ($j) => $j->on('i.id', '=', 'm.item_id')->where('i.company_id', '=', $f->companyId));
            $this->itemFilters($query, $f, 'i');
        }

        return $query;
    }

    /**
     * Category (with sub-categories) and search filters on an items alias.
     */
    public function itemFilters(Builder $query, ReportFilters $f, string $alias): void
    {
        if ($f->categoryId !== null) {
            $path = DB::table('item_categories')->where('company_id', $f->companyId)->where('id', $f->categoryId)->value('path');
            $query->whereIn("{$alias}.category_id", DB::table('item_categories')->where('company_id', $f->companyId)
                ->where('path', 'like', addcslashes(is_string($path) ? $path : '/none/', '%_\\').'%')->select('id'));
        }

        if ($f->q !== null) {
            $like = '%'.addcslashes($f->q, '%_\\').'%';
            $query->where(fn ($w) => $w->where("{$alias}.code", 'ilike', $like)->orWhere("{$alias}.name", 'ilike', $like));
        }
    }

    /**
     * Quantity and value per (item, warehouse) from the movements dated on or before $asOf.
     *
     * @return array<string, array{item_id: string, warehouse_id: string, quantity: BigDecimal, value: BigDecimal}>
     */
    public function pairTotals(ReportFilters $f, string $asOf, bool $inclusive = true): array
    {
        $rows = $this->movements($f)
            ->where('m.occurred_at', $inclusive ? '<=' : '<', $asOf)
            ->groupBy('m.item_id', 'm.warehouse_id')
            ->selectRaw('m.item_id, m.warehouse_id, sum('.self::SIGNED_QTY.') as quantity, sum('.self::SIGNED_VALUE.') as value')
            ->get();
        $totals = [];

        foreach ($rows as $row) {
            $totals[$row->item_id.'|'.$row->warehouse_id] = [
                'item_id' => (string) $row->item_id,
                'warehouse_id' => (string) $row->warehouse_id,
                'quantity' => Stock::dec((string) $row->quantity),
                'value' => Stock::dec((string) $row->value),
            ];
        }

        return $totals;
    }

    /**
     * Net consumption (issues and production use, less their reversals) per (item, warehouse)
     * dated within the range.
     *
     * @return array<string, array{item_id: string, warehouse_id: string, quantity: BigDecimal, value: BigDecimal}>
     */
    public function consumption(ReportFilters $f, string $from, string $to): array
    {
        $rows = $this->movements($f)
            ->whereBetween('m.occurred_at', [$from, $to])
            ->whereIn('m.movement_type', self::CONSUMPTION_TYPES)
            ->groupBy('m.item_id', 'm.warehouse_id')
            ->selectRaw('m.item_id, m.warehouse_id, sum(-('.self::SIGNED_QTY.')) as quantity, sum(-('.self::SIGNED_VALUE.')) as value')
            ->get();
        $totals = [];

        foreach ($rows as $row) {
            $totals[$row->item_id.'|'.$row->warehouse_id] = [
                'item_id' => (string) $row->item_id,
                'warehouse_id' => (string) $row->warehouse_id,
                'quantity' => Stock::dec((string) $row->quantity),
                'value' => Stock::dec((string) $row->value),
            ];
        }

        return $totals;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{code: string, name: string, base_unit_id: string, category_id: string|null}>
     */
    public function items(string $companyId, array $ids): array
    {
        $map = [];

        foreach (array_chunk(array_values(array_unique($ids)), 5000) as $chunk) {
            foreach (DB::table('items')->where('company_id', $companyId)->whereIn('id', $chunk)->get(['id', 'code', 'name', 'base_unit_id', 'category_id']) as $row) {
                $map[(string) $row->id] = [
                    'code' => (string) $row->code, 'name' => (string) $row->name, 'base_unit_id' => (string) $row->base_unit_id,
                    'category_id' => is_string($row->category_id) ? $row->category_id : null,
                ];
            }
        }

        return $map;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{code: string, name: string}>
     */
    public function warehouses(string $companyId, array $ids): array
    {
        return $this->codes('warehouses', $companyId, $ids);
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{code: string, name: string}>
     */
    public function categories(string $companyId, array $ids): array
    {
        return $this->codes('item_categories', $companyId, $ids);
    }

    public static function qty(BigDecimal $value): string
    {
        return Stock::qty($value);
    }

    public static function money(BigDecimal $value): string
    {
        return (string) Stock::money($value);
    }

    /** Average unit cost (value / quantity, scale 6) or zero without positive stock. */
    public static function average(BigDecimal $value, BigDecimal $qty): string
    {
        return $qty->isPositive() ? (string) $value->dividedBy($qty, 6, RoundingMode::HalfEven) : '0.000000';
    }

    /** Percentage part / whole x 100 at scale 4 (zero when the whole is not positive). */
    public static function percent(BigDecimal $part, BigDecimal $whole): BigDecimal
    {
        return $whole->isPositive() ? $part->multipliedBy(100)->dividedBy($whole, 4, RoundingMode::HalfEven) : BigDecimal::zero()->toScale(4);
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{code: string, name: string}>
     */
    private function codes(string $table, string $companyId, array $ids): array
    {
        $map = [];

        foreach (array_chunk(array_values(array_unique($ids)), 5000) as $chunk) {
            foreach (DB::table($table)->where('company_id', $companyId)->whereIn('id', $chunk)->get(['id', 'code', 'name']) as $row) {
                $map[(string) $row->id] = ['code' => (string) $row->code, 'name' => (string) $row->name];
            }
        }

        return $map;
    }
}
