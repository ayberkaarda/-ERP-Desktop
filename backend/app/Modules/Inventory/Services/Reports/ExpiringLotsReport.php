<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Reports;

use App\Modules\Inventory\Data\Reports\ReportFilters;
use App\Modules\Inventory\Data\Reports\ReportTable;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Lots in stock now (per lot and warehouse, all locations together) whose expiry date falls within
 * the next `days` days, soonest first; already expired lots are included (expired: true, negative
 * days_to_expiry) unless include_expired is false. Value is the lot's share of the warehouse value.
 */
final class ExpiringLotsReport
{
    public const array COLUMNS = [
        'lot_id', 'lot_no', 'expiry_date', 'days_to_expiry', 'expired', 'item_id', 'item_code', 'item_name', 'base_unit_id',
        'warehouse_id', 'warehouse_code', 'warehouse_name', 'on_hand', 'reserved', 'available', 'value',
    ];

    public function __construct(private readonly ReportQuery $query) {}

    public function build(ReportFilters $f, string $today, int $days, bool $includeExpired): ReportTable
    {
        $todayDate = new DateTimeImmutable($today);
        $until = $todayDate->modify("+{$days} days")->format('Y-m-d');
        $query = DB::table('stock_balances as b')
            ->join('stock_lots as l', fn ($j) => $j->on('l.id', '=', 'b.lot_id')->where('l.company_id', '=', $f->companyId))
            ->where('b.company_id', $f->companyId)
            ->whereNotNull('l.expiry_date')->where('l.expiry_date', '<=', $until);

        if (! $includeExpired) {
            $query->where('l.expiry_date', '>=', $today);
        }

        if ($f->warehouseId !== null) {
            $query->where('b.warehouse_id', $f->warehouseId);
        }

        if ($f->itemId !== null) {
            $query->where('b.item_id', $f->itemId);
        }

        if ($f->needsItems()) {
            $query->join('items as i', fn ($j) => $j->on('i.id', '=', 'b.item_id')->where('i.company_id', '=', $f->companyId));
            $this->query->itemFilters($query, $f, 'i');
        }

        $lots = $query->groupBy('b.item_id', 'b.warehouse_id', 'b.lot_id', 'l.lot_no', 'l.expiry_date')
            ->havingRaw('sum(b.on_hand) > 0')
            ->orderBy('l.expiry_date')->orderBy('l.lot_no')
            ->selectRaw('b.item_id, b.warehouse_id, b.lot_id, l.lot_no, l.expiry_date, sum(b.on_hand) as on_hand, sum(b.reserved) as reserved, sum(b.value) as value')
            ->get();

        $items = $this->query->items($f->companyId, array_values(array_map(static fn ($l): string => (string) $l->item_id, $lots->all())));
        $warehouses = $this->query->warehouses($f->companyId, array_values(array_map(static fn ($l): string => (string) $l->warehouse_id, $lots->all())));
        $rows = [];
        $total = BigDecimal::zero();
        $expired = 0;

        foreach ($lots as $lot) {
            $expiry = (string) $lot->expiry_date;
            $daysLeft = (int) $todayDate->diff(new DateTimeImmutable($expiry))->format('%r%a');
            $onHand = Stock::dec((string) $lot->on_hand);
            $reserved = Stock::dec((string) $lot->reserved);
            $value = Stock::dec((string) $lot->value);
            $total = $total->plus($value);
            $expired += $daysLeft < 0 ? 1 : 0;
            $item = $items[(string) $lot->item_id] ?? null;
            $warehouse = $warehouses[(string) $lot->warehouse_id] ?? null;
            $rows[] = [
                'lot_id' => (string) $lot->lot_id,
                'lot_no' => (string) $lot->lot_no,
                'expiry_date' => $expiry,
                'days_to_expiry' => $daysLeft,
                'expired' => $daysLeft < 0,
                'item_id' => (string) $lot->item_id,
                'item_code' => $item['code'] ?? null,
                'item_name' => $item['name'] ?? null,
                'base_unit_id' => $item['base_unit_id'] ?? null,
                'warehouse_id' => (string) $lot->warehouse_id,
                'warehouse_code' => $warehouse['code'] ?? null,
                'warehouse_name' => $warehouse['name'] ?? null,
                'on_hand' => ReportQuery::qty($onHand),
                'reserved' => ReportQuery::qty($reserved),
                'available' => ReportQuery::qty($onHand->minus($reserved)),
                'value' => ReportQuery::money($value),
            ];
        }

        usort($rows, static fn (array $a, array $b): int => PairGroups::compare(
            [(string) $a['expiry_date'], (string) $a['item_code'], (string) $a['lot_no'], (string) $a['warehouse_code']],
            [(string) $b['expiry_date'], (string) $b['item_code'], (string) $b['lot_no'], (string) $b['warehouse_code']],
        ));

        return new ReportTable($rows, self::COLUMNS, [
            'as_of' => $today,
            'days' => $days,
            'until' => $until,
            'include_expired' => $includeExpired,
            'totals' => ['lots' => count($rows), 'expired' => $expired, 'value' => ReportQuery::money($total)],
        ]);
    }
}
