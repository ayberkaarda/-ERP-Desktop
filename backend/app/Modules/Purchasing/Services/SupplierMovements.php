<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Enums\ReceiptStatus;
use App\Modules\Purchasing\Enums\ReturnStatus;
use App\Modules\Purchasing\Support\Purchasing;
use Brick\Math\BigDecimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Dated, signed purchasing movements over [from, to], the way the ledger and the stock book them,
 * shared by the SupplierPerformance contract and the purchasing reports:
 * - a posted receipt counts +1 on its document date and, once cancelled, -1 on its reversal date,
 *   so a later cancellation never changes an earlier period;
 * - a booked supplier invoice counts +1 on its document date and, once reversed, -1 on its reversal
 *   date; debit notes count with the opposite sign;
 * - price variance = invoice line variances (signed as above) + return receipt-cost corrections
 *   (stock cost - receipt value of shipped returns, on the return date).
 */
final class SupplierMovements
{
    /**
     * Factor of a receipt row (alias) inside the range: +1 posted in it, -1 cancelled in it, 0 both.
     *
     * @param  literal-string  $alias
     * @return array{0: literal-string, 1: list<string>}
     */
    public static function receiptFactor(string $from, string $to, string $alias = 'r'): array
    {
        return [
            "((CASE WHEN {$alias}.document_date BETWEEN ? AND ? THEN 1 ELSE 0 END) - (CASE WHEN {$alias}.status = ? AND {$alias}.reversal_date BETWEEN ? AND ? THEN 1 ELSE 0 END))",
            [$from, $to, ReceiptStatus::Cancelled->value, $from, $to],
        ];
    }

    /** Posted receipts (alias) with a movement in the range. */
    public static function receiptsMoving(Builder $query, string $from, string $to, string $alias = 'r'): Builder
    {
        return $query->whereNotNull("{$alias}.posted_at")
            ->where(fn (Builder $q) => $q->whereBetween("{$alias}.document_date", [$from, $to])
                ->orWhere(fn (Builder $c) => $c->where("{$alias}.status", ReceiptStatus::Cancelled->value)->whereBetween("{$alias}.reversal_date", [$from, $to])));
    }

    /**
     * Factor of an invoice row (alias) inside the range: +1 booked in it, -1 reversed in it, negated
     * for debit notes.
     *
     * @param  literal-string  $alias
     * @return array{0: literal-string, 1: list<string>}
     */
    public static function invoiceFactor(string $from, string $to, string $alias = 'i'): array
    {
        return [
            "(CASE WHEN {$alias}.invoice_type = ? THEN -1 ELSE 1 END) * ((CASE WHEN {$alias}.document_date BETWEEN ? AND ? THEN 1 ELSE 0 END)"
                ." - (CASE WHEN {$alias}.status = ? AND {$alias}.reversal_date BETWEEN ? AND ? THEN 1 ELSE 0 END))",
            [InvoiceType::Return->value, $from, $to, InvoiceStatus::Reversed->value, $from, $to],
        ];
    }

    /** Booked (or reversed) invoices (alias) with a movement in the range. */
    public static function invoicesMoving(Builder $query, string $from, string $to, string $alias = 'i'): Builder
    {
        return $query->whereIn("{$alias}.status", [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value])
            ->where(fn (Builder $q) => $q->whereBetween("{$alias}.document_date", [$from, $to])
                ->orWhere(fn (Builder $r) => $r->where("{$alias}.status", InvoiceStatus::Reversed->value)->whereBetween("{$alias}.reversal_date", [$from, $to])));
    }

    /**
     * Price variance per supplier in company currency (scale 4).
     *
     * @return array<string, BigDecimal>
     */
    public function varianceByParty(string $companyId, string $from, string $to, ?string $partyId = null): array
    {
        [$factor, $bindings] = self::invoiceFactor($from, $to);
        $invoices = self::invoicesMoving(DB::table('purchase_invoice_lines as l')->join('purchase_invoices as i', 'i.id', '=', 'l.document_id')
            ->where('i.company_id', $companyId)->where('l.company_id', $companyId)->where('l.variance_amount', '<>', 0), $from, $to)
            ->when($partyId !== null, fn (Builder $q) => $q->where('i.party_id', $partyId))
            ->groupBy('i.party_id')->selectRaw("i.party_id, coalesce(sum(l.variance_amount * {$factor}), 0) AS amount", $bindings)->get();
        $returns = DB::table('purchase_return_lines as l')->join('purchase_returns as r', 'r.id', '=', 'l.document_id')
            ->where('r.company_id', $companyId)->where('l.company_id', $companyId)
            ->whereIn('r.status', [ReturnStatus::Shipped->value, ReturnStatus::Debited->value])->whereBetween('r.document_date', [$from, $to])
            ->whereNotNull('l.receipt_cost')->whereNotNull('l.cost_total')
            ->when($partyId !== null, fn (Builder $q) => $q->where('r.party_id', $partyId))
            ->groupBy('r.party_id')->selectRaw('r.party_id, coalesce(sum(l.cost_total - l.receipt_cost), 0) AS amount')->get();
        $out = [];

        foreach ([...$invoices->all(), ...$returns->all()] as $row) {
            $party = (string) $row->party_id;
            $out[$party] = ($out[$party] ?? BigDecimal::zero())->plus(Purchasing::dec(is_numeric($row->amount) ? (string) $row->amount : '0'));
        }

        return $out;
    }

    /**
     * Receipt lines (on_time against the expected date of their order line, else order) and base
     * quantity received per supplier, signed per receiptFactor.
     *
     * @return array<string, array{lines: int, on_time: int, quantity: BigDecimal}>
     */
    public function receivedByParty(string $companyId, string $from, string $to, ?string $partyId = null): array
    {
        [$factor, $bindings] = self::receiptFactor($from, $to);
        $quantities = self::receiptsMoving(DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
            ->where('r.company_id', $companyId)->where('l.company_id', $companyId), $from, $to)
            ->when($partyId !== null, fn (Builder $q) => $q->where('r.party_id', $partyId))
            ->groupBy('r.party_id')->selectRaw("r.party_id, coalesce(sum(l.base_quantity * {$factor}), 0) AS qty", $bindings)->get();
        $onTime = self::receiptsMoving(DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.document_id')
            ->join('purchase_order_lines as ol', 'ol.id', '=', 'l.order_line_id')->join('purchase_orders as o', 'o.id', '=', 'ol.document_id')
            ->where('r.company_id', $companyId)->where('l.company_id', $companyId)->where('ol.company_id', $companyId)->where('o.company_id', $companyId), $from, $to)
            ->when($partyId !== null, fn (Builder $q) => $q->where('r.party_id', $partyId))
            ->groupBy('r.party_id')
            ->selectRaw("r.party_id, coalesce(sum({$factor}), 0) AS lines, coalesce(sum({$factor}) FILTER (WHERE r.document_date <= coalesce(ol.expected_date, o.expected_date, r.document_date)), 0) AS on_time",
                [...$bindings, ...$bindings])
            ->get();
        $out = [];

        foreach ($quantities as $row) {
            $out[(string) $row->party_id] = ['lines' => 0, 'on_time' => 0, 'quantity' => Purchasing::dec(is_numeric($row->qty) ? (string) $row->qty : '0')];
        }

        foreach ($onTime as $row) {
            $party = (string) $row->party_id;
            $out[$party] ??= ['lines' => 0, 'on_time' => 0, 'quantity' => BigDecimal::zero()];
            $out[$party]['lines'] = (int) $row->lines;
            $out[$party]['on_time'] = (int) $row->on_time;
        }

        return $out;
    }
}
