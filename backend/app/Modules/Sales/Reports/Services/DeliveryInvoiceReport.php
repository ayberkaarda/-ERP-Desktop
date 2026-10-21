<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Enums\DeliveryStatus;
use App\Modules\Sales\Enums\InvoiceStatus;
use App\Modules\Sales\Enums\InvoiceType;
use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * Goods delivered and not invoiced as of a date, rebuilt from the document dates:
 * - delivery lines of deliveries posted on or before as_of and not cancelled by then (a delivery
 *   whose stock reversal is dated after as_of still counts);
 * - invoiced = sale invoice lines on that delivery line issued on or before as_of and not reversed
 *   by then (reversal_date after as_of still counts as invoiced);
 * - in_draft_quantity: current draft/pending invoice lines on it (today, not as of).
 * uninvoiced_value = delivery line net x uninvoiced / quantity (delivery currency, cents) and
 * _local at the delivery fx_rate; uninvoiced_cost = recorded cost_total x uninvoiced / quantity.
 * The optional date range filters on the delivery date. Groups: line (default), delivery, customer, item.
 */
final class DeliveryInvoiceReport
{
    public const array GROUPS = ['line', 'delivery', 'customer', 'item'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'line' => ['delivery_id', 'delivery_number', 'document_date', 'days_open', 'order_id', 'order_number', 'party_id', 'party_name', 'line_no',
                'item_id', 'item_code', 'item_name', 'unit_id', 'warehouse_id', 'currency_code', 'quantity', 'invoiced_quantity', 'uninvoiced_quantity',
                'in_draft_quantity', 'uninvoiced_base_quantity', 'uninvoiced_value', 'uninvoiced_value_local', 'uninvoiced_cost'],
            'delivery' => ['delivery_id', 'delivery_number', 'document_date', 'days_open', 'order_id', 'order_number', 'party_id', 'party_name',
                'currency_code', 'line_count', 'uninvoiced_value', 'uninvoiced_value_local', 'uninvoiced_cost'],
            'customer' => ['party_id', 'party_code', 'party_name', 'delivery_count', 'line_count', 'uninvoiced_value_local', 'uninvoiced_cost'],
            default => ['item_id', 'item_code', 'item_name', 'delivery_count', 'uninvoiced_base_quantity', 'uninvoiced_value_local', 'uninvoiced_cost'],
        };
    }

    public function build(ReportFilters $f, string $by): ReportTable
    {
        $asOf = (string) $f->asOf;
        $lines = [];
        $totalLocal = BigDecimal::zero();
        $totalCost = BigDecimal::zero();
        $deliveries = [];

        foreach ($this->query($f, $asOf)->lazyById(1000, 'l.id', 'id') as $row) {
            if ($f->categoryId !== null && $this->items->categoryOf((string) $row->item_id) !== $f->categoryId) {
                continue;
            }

            $qty = Num::dec($row->quantity);
            $invoiced = Num::dec($row->invoiced);
            $open = $qty->minus($invoiced);

            if (! $open->isPositive()) {
                continue;
            }

            $share = static fn (mixed $amount): BigDecimal => Num::cents(Num::dec($amount)->multipliedBy($open)->dividedBy($qty, 10, RoundingMode::HalfUp));
            $value = $share($row->net_amount);
            $local = Num::cents($value->multipliedBy(Num::dec($row->fx_rate)));
            $cost = $share($row->cost_total ?? '0');
            $lines[] = [
                'delivery_id' => (string) $row->delivery_id, 'delivery_number' => $row->number, 'document_date' => (string) $row->document_date,
                'days_open' => (int) (new DateTimeImmutable((string) $row->document_date))->diff(new DateTimeImmutable($asOf))->days,
                'order_id' => $row->order_id, 'order_number' => $row->order_number, 'party_id' => (string) $row->party_id, 'party_name' => (string) $row->party_name,
                'line_no' => (int) $row->line_no, 'item_id' => (string) $row->item_id, 'item_code' => null, 'item_name' => null, 'unit_id' => (string) $row->unit_id,
                'warehouse_id' => $row->warehouse_id, 'currency_code' => (string) $row->currency_code,
                'quantity' => Num::qty($qty), 'invoiced_quantity' => Num::qty($invoiced), 'uninvoiced_quantity' => Num::qty($open),
                'in_draft_quantity' => Num::qty(Num::dec($row->in_draft)),
                'uninvoiced_base_quantity' => Num::qty(Num::dec($row->base_quantity)->multipliedBy($open)->dividedBy($qty, 6, RoundingMode::HalfUp)),
                'uninvoiced_value' => Num::money($value), 'uninvoiced_value_local' => Num::money($local), 'uninvoiced_cost' => Num::money($cost),
            ];
            $totalLocal = $totalLocal->plus($local);
            $totalCost = $totalCost->plus($cost);
            $deliveries[(string) $row->delivery_id] = true;
        }

        usort($lines, static fn (array $a, array $b): int => [$a['document_date'], (string) $a['delivery_number'], $a['line_no']] <=> [$b['document_date'], (string) $b['delivery_number'], $b['line_no']]);

        return new ReportTable($by === 'line' ? $lines : self::group($lines, $by), self::columns($by), [
            'as_of' => $asOf,
            'group_by' => $by,
            'totals' => ['delivery_count' => count($deliveries), 'line_count' => count($lines),
                'uninvoiced_value_local' => Num::money($totalLocal), 'uninvoiced_cost' => Num::money($totalCost)],
        ]);
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

    private function query(ReportFilters $f, string $asOf): Builder
    {
        $booked = [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value];
        $drafts = [InvoiceStatus::Draft->value, InvoiceStatus::PendingApproval->value];
        $invoiced = DB::table('sales_invoice_lines as il')->join('sales_invoices as i', 'i.id', '=', 'il.document_id')
            ->where('i.company_id', $f->companyId)->where('il.company_id', $f->companyId)->where('i.invoice_type', InvoiceType::Sale->value)->whereNotNull('il.delivery_line_id')
            ->groupBy('il.delivery_line_id')
            ->select('il.delivery_line_id')
            ->selectRaw(
                'coalesce(sum(il.quantity) FILTER (WHERE i.status = ANY(?::text[]) AND i.document_date <= ? AND (i.status <> ? OR i.reversal_date > ?)), 0) AS invoiced',
                [self::pgArray($booked), $asOf, InvoiceStatus::Reversed->value, $asOf],
            )
            ->selectRaw('coalesce(sum(il.quantity) FILTER (WHERE i.status = ANY(?::text[])), 0) AS in_draft', [self::pgArray($drafts)]);

        return DB::table('sales_delivery_lines as l')->join('sales_deliveries as d', 'd.id', '=', 'l.document_id')
            ->leftJoin('sales_orders as o', fn (JoinClause $j) => $j->on('o.id', '=', 'd.order_id')->where('o.company_id', '=', $f->companyId))
            ->leftJoinSub($invoiced, 'inv', 'inv.delivery_line_id', '=', 'l.id')
            ->where('d.company_id', $f->companyId)->where('l.company_id', $f->companyId)->whereNotNull('d.posted_at')
            ->where('d.document_date', '<=', $asOf)
            ->where(fn (Builder $q) => $q->where('d.status', DeliveryStatus::Posted->value)
                ->orWhere(fn (Builder $r) => $r->where('d.status', DeliveryStatus::Cancelled->value)->where('d.reversal_date', '>', $asOf)))
            ->when($f->dateFrom !== null, fn (Builder $q) => $q->where('d.document_date', '>=', $f->dateFrom))
            ->when($f->dateTo !== null, fn (Builder $q) => $q->where('d.document_date', '<=', $f->dateTo))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('d.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('d.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->where('d.warehouse_id', $f->warehouseId))
            ->select(['l.id', 'l.document_id as delivery_id', 'l.line_no', 'l.item_id', 'l.unit_id', 'l.quantity', 'l.base_quantity', 'l.net_amount', 'l.cost_total',
                'd.number', 'd.document_date', 'd.order_id', 'o.number as order_number', 'd.party_id', 'd.party_name', 'd.warehouse_id', 'd.currency_code', 'd.fx_rate',
                DB::raw('coalesce(inv.invoiced, 0) AS invoiced'), DB::raw('coalesce(inv.in_draft, 0) AS in_draft')]);
    }

    /**
     * Postgres array literal of enum values (plain lowercase words, nothing to escape).
     *
     * @param  list<string>  $values
     */
    private static function pgArray(array $values): string
    {
        return '{'.implode(',', $values).'}';
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
                'delivery' => $line['delivery_id'],
                'customer' => $line['party_id'],
                default => $line['item_id'],
            };
            $g = $groups[$key] ?? match ($by) {
                'delivery' => [...array_intersect_key($line, array_flip(self::columns('delivery'))), 'line_count' => 0, 'uninvoiced_value' => '0', 'uninvoiced_value_local' => '0', 'uninvoiced_cost' => '0'],
                'customer' => ['party_id' => $line['party_id'], 'party_code' => null, 'party_name' => $line['party_name'], 'delivery_count' => 0, 'line_count' => 0],
                default => ['item_id' => $line['item_id'], 'item_code' => null, 'item_name' => null, 'delivery_count' => 0, 'uninvoiced_base_quantity' => '0'],
            };
            $g['uninvoiced_value_local'] = Num::money(Num::dec($g['uninvoiced_value_local'] ?? '0')->plus(Num::dec($line['uninvoiced_value_local'])));
            $g['uninvoiced_cost'] = Num::money(Num::dec($g['uninvoiced_cost'] ?? '0')->plus(Num::dec($line['uninvoiced_cost'])));

            if ($by === 'delivery') {
                $g['uninvoiced_value'] = Num::money(Num::dec($g['uninvoiced_value'])->plus(Num::dec($line['uninvoiced_value'])));
            } else {
                $sets[$key][(string) $line['delivery_id']] = true;
                $g['delivery_count'] = count($sets[$key]);
            }

            if ($by === 'item') {
                $g['uninvoiced_base_quantity'] = Num::qty(Num::dec($g['uninvoiced_base_quantity'])->plus(Num::dec($line['uninvoiced_base_quantity'])));
            } else {
                $g['line_count'] = (int) $g['line_count'] + 1;
            }

            $groups[$key] = $g;
        }

        return SalesGroupReport::sortByNet(array_values($groups), 'uninvoiced_value_local');
    }
}
