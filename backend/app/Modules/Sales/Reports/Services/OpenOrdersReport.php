<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Order backlog now: lines of confirmed, partially delivered, delivered and partially invoiced
 * orders (drafts, pending approval, invoiced, closed and cancelled orders excluded) with a quantity
 * still to deliver; for service lines (never delivered) the quantity still to invoice.
 * open_value = net_amount x open / quantity in the order currency (excluding VAT, cents),
 * open_value_local = open_value x order fx_rate (cents). days_late counts from the requested
 * delivery date to `today`. The optional date range filters on the order date.
 * Groups: line (default), order, customer, item; lines oldest requested date first, groups by value.
 */
final class OpenOrdersReport
{
    public const array GROUPS = ['line', 'order', 'customer', 'item'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'line' => ['order_id', 'order_number', 'order_status', 'document_date', 'requested_delivery_date', 'days_late', 'party_id', 'party_name',
                'line_no', 'item_id', 'item_code', 'item_name', 'item_type', 'unit_id', 'warehouse_id', 'currency_code', 'fx_rate',
                'quantity', 'delivered_quantity', 'invoiced_quantity', 'open_quantity', 'open_base_quantity', 'open_value', 'open_value_local'],
            'order' => ['order_id', 'order_number', 'order_status', 'document_date', 'requested_delivery_date', 'days_late', 'party_id', 'party_name',
                'currency_code', 'line_count', 'open_value', 'open_value_local'],
            'customer' => ['party_id', 'party_code', 'party_name', 'order_count', 'line_count', 'open_value_local'],
            default => ['item_id', 'item_code', 'item_name', 'order_count', 'open_base_quantity', 'open_value_local'],
        };
    }

    public function build(ReportFilters $f, string $by, string $today): ReportTable
    {
        $lines = [];
        $currencies = [];
        $total = BigDecimal::zero();
        $orders = [];

        foreach ($this->query($f)->lazyById(1000, 'l.id', 'id') as $row) {
            if ($f->categoryId !== null && $this->items->categoryOf((string) $row->item_id) !== $f->categoryId) {
                continue;
            }

            $qty = Num::dec($row->quantity);
            $done = Num::dec($row->item_type === 'service' ? $row->invoiced_quantity : $row->delivered_quantity);
            $open = $qty->minus($done);

            if (! $open->isPositive()) {
                continue;
            }

            $value = Num::cents(Num::dec($row->net_amount)->multipliedBy($open)->dividedBy($qty, 10, RoundingMode::HalfUp));
            $local = Num::cents($value->multipliedBy(Num::dec($row->fx_rate)));
            $requested = is_string($row->requested_delivery_date) ? $row->requested_delivery_date : null;
            $lines[] = [
                'order_id' => (string) $row->order_id, 'order_number' => $row->number, 'order_status' => (string) $row->status,
                'document_date' => (string) $row->document_date, 'requested_delivery_date' => $requested, 'days_late' => self::daysLate($requested, $today),
                'party_id' => (string) $row->party_id, 'party_name' => (string) $row->party_name,
                'line_no' => (int) $row->line_no, 'item_id' => (string) $row->item_id, 'item_code' => null, 'item_name' => null,
                'item_type' => (string) $row->item_type, 'unit_id' => (string) $row->unit_id, 'warehouse_id' => is_string($row->warehouse_id) ? $row->warehouse_id : null,
                'currency_code' => (string) $row->currency_code, 'fx_rate' => Num::qty(Num::dec($row->fx_rate)),
                'quantity' => Num::qty($qty), 'delivered_quantity' => Num::qty(Num::dec($row->delivered_quantity)),
                'invoiced_quantity' => Num::qty(Num::dec($row->invoiced_quantity)), 'open_quantity' => Num::qty($open),
                'open_base_quantity' => Num::qty(Num::dec($row->base_quantity)->multipliedBy($open)->dividedBy($qty, 6, RoundingMode::HalfUp)),
                'open_value' => Num::money($value), 'open_value_local' => Num::money($local),
            ];
            $currencies[(string) $row->currency_code] = ($currencies[(string) $row->currency_code] ?? BigDecimal::zero())->plus($value);
            $total = $total->plus($local);
            $orders[(string) $row->order_id] = true;
        }

        ksort($currencies);
        $meta = [
            'today' => $today,
            'group_by' => $by,
            'totals' => ['order_count' => count($orders), 'line_count' => count($lines), 'open_value_local' => Num::money($total)],
            'by_currency' => array_map(static fn (string $c, BigDecimal $v): array => ['currency_code' => $c, 'open_value' => Num::money($v)], array_keys($currencies), array_values($currencies)),
        ];

        usort($lines, static fn (array $a, array $b): int => [$a['requested_delivery_date'] ?? '9999-12-31', $a['document_date'], (string) $a['order_number'], $a['line_no']]
            <=> [$b['requested_delivery_date'] ?? '9999-12-31', $b['document_date'], (string) $b['order_number'], $b['line_no']]);

        return new ReportTable($by === 'line' ? $lines : self::group($lines, $by), self::columns($by), $meta);
    }

    /**
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public function decorate(array $rows, string $by): array
    {
        return match ($by) {
            'line', 'item' => $this->items->withItems($rows),
            'customer' => $this->items->withParties($rows),
            default => $rows,
        };
    }

    private function query(ReportFilters $f): Builder
    {
        return DB::table('sales_order_lines as l')->join('sales_orders as o', 'o.id', '=', 'l.document_id')
            ->where('o.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->whereIn('o.status', OrderStatus::openValues())
            ->when($f->dateFrom !== null, fn (Builder $q) => $q->where('o.document_date', '>=', $f->dateFrom))
            ->when($f->dateTo !== null, fn (Builder $q) => $q->where('o.document_date', '<=', $f->dateTo))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('o.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('o.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw('coalesce(l.warehouse_id, o.warehouse_id) = ?', [$f->warehouseId]))
            ->select(['l.id', 'l.document_id as order_id', 'l.line_no', 'l.item_id', 'l.item_type', 'l.unit_id', 'l.quantity', 'l.base_quantity',
                'l.delivered_quantity', 'l.invoiced_quantity', 'l.net_amount', DB::raw('coalesce(l.warehouse_id, o.warehouse_id) AS warehouse_id'),
                'o.number', 'o.status', 'o.document_date', 'o.requested_delivery_date', 'o.party_id', 'o.party_name', 'o.currency_code', 'o.fx_rate']);
    }

    private static function daysLate(?string $requested, string $today): int
    {
        if ($requested === null || $requested >= $today) {
            return 0;
        }

        return (int) (new DateTimeImmutable($requested))->diff(new DateTimeImmutable($today))->days;
    }

    /**
     * @param  list<array<string, string|int|null>>  $lines
     * @return list<array<string, string|int|null>>
     */
    private static function group(array $lines, string $by): array
    {
        $groups = [];
        $sets = [];

        foreach ($lines as $line) {
            $key = (string) match ($by) {
                'order' => $line['order_id'],
                'customer' => $line['party_id'],
                default => $line['item_id'],
            };
            $g = $groups[$key] ?? match ($by) {
                'order' => [...array_intersect_key($line, array_flip(self::columns('order'))), 'line_count' => 0, 'open_value' => '0', 'open_value_local' => '0'],
                'customer' => ['party_id' => $line['party_id'], 'party_code' => null, 'party_name' => $line['party_name'], 'order_count' => 0, 'line_count' => 0],
                default => ['item_id' => $line['item_id'], 'item_code' => null, 'item_name' => null, 'order_count' => 0, 'open_base_quantity' => '0'],
            };
            $g['open_value_local'] = Num::money(Num::dec($g['open_value_local'] ?? '0')->plus(Num::dec($line['open_value_local'])));

            if ($by === 'order') {
                $g['open_value'] = Num::money(Num::dec($g['open_value'])->plus(Num::dec($line['open_value'])));
            } else {
                $sets[$key][(string) $line['order_id']] = true;
                $g['order_count'] = count($sets[$key]);
            }

            if ($by === 'item') {
                $g['open_base_quantity'] = Num::qty(Num::dec($g['open_base_quantity'])->plus(Num::dec($line['open_base_quantity'])));
            } else {
                $g['line_count'] = (int) $g['line_count'] + 1;
            }

            $groups[$key] = $g;
        }

        return SalesGroupReport::sortByNet(array_values($groups), 'open_value_local');
    }
}
