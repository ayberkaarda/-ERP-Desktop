<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Data\ReportTable;
use App\Modules\Purchasing\Reports\Support\Num;
use App\Modules\Purchasing\Reports\Support\ReturnWarehouse;
use App\Modules\Purchasing\Services\SupplierMovements;
use App\Modules\Purchasing\Support\Export;
use Brick\Math\BigDecimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Goods sent back to suppliers against goods received in the range (the physical view the
 * SupplierPerformance return_rate uses): received = receipt lines as dated movements, at base
 * quantity and recorded cost: + on the receipt date, - on the reversal date of a cancelled receipt
 * (a later cancellation never changes an earlier range; receipt_count counts receipts received in
 * the range); returned = lines of returns shipped dated in the range, at base quantity and the
 * receipt value they carried. quantity_rate_percent = returned / received base quantity,
 * value_rate_percent = returned / received value (null when nothing was received). A return counts
 * in its own range, which may differ from the range of its receipt.
 * Groups: supplier (default), item, category; most returned value first.
 */
final class ReturnRateReport
{
    public const array GROUPS = ['supplier', 'item', 'category'];

    private const array FIGURES = ['receipt_count', 'return_count', 'received_quantity', 'returned_quantity', 'quantity_rate_percent',
        'received_value', 'returned_value', 'value_rate_percent'];

    public function __construct(private readonly ItemDirectory $items) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'supplier' => ['party_id', 'party_code', 'party_name', ...self::FIGURES],
            'item' => ['item_id', 'item_code', 'item_name', 'category_id', ...self::FIGURES],
            default => ['category_id', ...self::FIGURES],
        };
    }

    /** $cap: an export refused (422) as soon as it has more groups. */
    public function build(ReportFilters $f, string $by, ?int $cap = null): ReportTable
    {
        $preload = $f->categoryId !== null || $by === 'category';
        /** @var array<string, array{party_name: string, date: string, docs: array<string, array<string, true>>, sums: array<string, BigDecimal>}> $groups */
        $groups = [];
        $totals = ['received_quantity' => BigDecimal::zero(), 'returned_quantity' => BigDecimal::zero(), 'received_value' => BigDecimal::zero(), 'returned_value' => BigDecimal::zero()];

        foreach ([['receipt', $this->receipts($f)], ['return', $this->returns($f)]] as [$kind, $query]) {
            foreach ($this->items->stream($query->lazyById(1000, 'l.id', 'id'), $preload) as $row) {
                $category = $preload ? $this->items->categoryOf((string) $row->item_id) : null;

                // A receipt both received and cancelled inside the range moves nothing.
                if (($f->categoryId !== null && $category !== $f->categoryId) || (int) $row->factor === 0) {
                    continue;
                }

                $key = match ($by) {
                    'supplier' => (string) $row->party_id,
                    'item' => (string) $row->item_id,
                    default => $category ?? '',
                };
                if ($cap !== null && ! isset($groups[$key]) && count($groups) >= $cap) {
                    Export::assertWithinCap($cap + 1);
                }

                $g = $groups[$key] ?? ['party_name' => '', 'date' => '', 'docs' => ['receipt' => [], 'return' => []],
                    'sums' => ['received_quantity' => BigDecimal::zero(), 'returned_quantity' => BigDecimal::zero(), 'received_value' => BigDecimal::zero(), 'returned_value' => BigDecimal::zero()]];
                $qty = $kind === 'receipt' ? 'received_quantity' : 'returned_quantity';
                $value = $kind === 'receipt' ? 'received_value' : 'returned_value';
                $g['sums'][$qty] = $g['sums'][$qty]->plus(Num::dec($row->base_quantity));
                $g['sums'][$value] = $g['sums'][$value]->plus(Num::dec($row->value));
                if ((int) $row->factor > 0) {
                    $g['docs'][$kind][(string) $row->document_id] = true;
                }
                $totals[$qty] = $totals[$qty]->plus(Num::dec($row->base_quantity));
                $totals[$value] = $totals[$value]->plus(Num::dec($row->value));

                if ((string) $row->document_date >= $g['date']) {
                    $g['date'] = (string) $row->document_date;
                    $g['party_name'] = (string) $row->party_name;
                }

                $groups[$key] = $g;
            }
        }

        $rows = [];

        foreach ($groups as $key => $g) {
            $key = (string) $key;
            $s = $g['sums'];
            $figures = [
                'receipt_count' => count($g['docs']['receipt']), 'return_count' => count($g['docs']['return']),
                'received_quantity' => Num::qty($s['received_quantity']), 'returned_quantity' => Num::qty($s['returned_quantity']),
                'quantity_rate_percent' => Num::percent($s['returned_quantity'], $s['received_quantity']),
                'received_value' => Num::money($s['received_value']), 'returned_value' => Num::money($s['returned_value']),
                'value_rate_percent' => Num::percent($s['returned_value'], $s['received_value']),
            ];
            $rows[] = match ($by) {
                'supplier' => ['party_id' => $key, 'party_code' => null, 'party_name' => $g['party_name'], ...$figures],
                'item' => ['item_id' => $key, 'item_code' => null, 'item_name' => null, 'category_id' => null, ...$figures],
                default => ['category_id' => $key === '' ? null : $key, ...$figures],
            };
        }

        return new ReportTable(PurchaseGroupReport::sortBy($rows, 'returned_value'), self::columns($by), [
            'group_by' => $by,
            'totals' => [
                'received_quantity' => Num::qty($totals['received_quantity']), 'returned_quantity' => Num::qty($totals['returned_quantity']),
                'quantity_rate_percent' => Num::percent($totals['returned_quantity'], $totals['received_quantity']),
                'received_value' => Num::money($totals['received_value']), 'returned_value' => Num::money($totals['returned_value']),
                'value_rate_percent' => Num::percent($totals['returned_value'], $totals['received_value']),
            ],
        ]);
    }

    /** Receipt lines moving in the range, signed: +1 received in it, -1 cancelled in it (SupplierMovements). */
    private function receipts(ReportFilters $f): Builder
    {
        [$factor, $bindings] = SupplierMovements::receiptFactor((string) $f->dateFrom, (string) $f->dateTo);

        return $this->filtered(SupplierMovements::receiptsMoving(DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id'),
            (string) $f->dateFrom, (string) $f->dateTo), $f)
            ->select(['l.id', 'l.document_id', 'l.item_id', 'r.document_date', 'r.party_id', 'r.party_name'])
            ->selectRaw("{$factor} AS factor", $bindings)
            ->selectRaw("l.base_quantity * {$factor} AS base_quantity", $bindings)
            ->selectRaw("coalesce(l.cost_total, 0) * {$factor} AS value", $bindings);
    }

    private function returns(ReportFilters $f): Builder
    {
        return $this->filtered(DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
            ->whereIn('r.status', [ReturnStatus::Shipped->value, ReturnStatus::Debited->value])
            ->whereBetween('r.document_date', [(string) $f->dateFrom, (string) $f->dateTo]), $f, true)
            ->select(['l.id', 'l.document_id', 'l.item_id', 'l.base_quantity', DB::raw('coalesce(l.receipt_cost, 0) AS value'),
                'r.document_date', 'r.party_id', 'r.party_name', DB::raw('1 AS factor')]);
    }

    private function filtered(Builder $query, ReportFilters $f, bool $return = false): Builder
    {
        return $query->where('r.company_id', $f->companyId)->where('l.company_id', $f->companyId)
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('r.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('r.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->where('l.item_id', $f->itemId))
            ->when($f->warehouseId !== null, fn (Builder $q) => $q->whereRaw(($return ? ReturnWarehouse::expression() : 'r.warehouse_id').' = ?', [$f->warehouseId]));
    }
}
