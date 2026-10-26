<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Services;

use App\Core\Money\RoundingPolicy;
use App\Modules\Purchasing\Enums\InvoiceStatus;
use App\Modules\Purchasing\Enums\InvoiceType;
use App\Modules\Purchasing\Reports\Data\PurchaseFact;
use App\Modules\Purchasing\Reports\Data\ReportFilters;
use App\Modules\Purchasing\Reports\Support\Num;
use Brick\Math\BigDecimal;
use Closure;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Streams the purchase movements of the supplier invoices in a range, the way the ledger books them:
 * - booked (also partially_paid/paid/reversed) invoices and debit notes count on their document
 *   date; a reversed one counts again, negated, on its reversal date, so an invoice reversed inside
 *   the range nets to zero and one reversed later stays in its own period;
 * - drafts, pending approval and cancelled invoices never count.
 * Headers come in chunks with all their lines in one query per chunk (allocation needs every line
 * of an invoice); item, warehouse and category filters then apply per line.
 */
final class PurchaseFacts
{
    private const int CHUNK = 500;

    public function __construct(private readonly ItemDirectory $items) {}

    /**
     * @param  Closure(PurchaseFact): void  $sink
     */
    public function each(ReportFilters $f, Closure $sink): void
    {
        $from = (string) $f->dateFrom;
        $to = (string) $f->dateTo;

        $this->headers($f)->chunkById(self::CHUNK, function ($headers) use ($f, $from, $to, $sink): void {
            $all = DB::table('purchase_invoice_lines')->where('company_id', $f->companyId)->whereIn('document_id', $headers->pluck('id')->all())
                ->orderBy('document_id')->orderBy('line_no')
                ->get(['document_id', 'item_id', 'item_type', 'warehouse_id', 'base_quantity', 'net_amount', 'tax_amount', 'withholding_amount', 'net_local']);

            if ($f->categoryId !== null || $this->items->wantsCategories()) {
                $this->items->preload($all->pluck('item_id'));
            }

            $lines = $all->groupBy('document_id');

            foreach ($headers as $header) {
                $own = $lines->get($header->id);

                if ($own === null || $own->isEmpty()) {
                    continue;
                }

                $events = [];

                if ($header->document_date >= $from && $header->document_date <= $to) {
                    $events[] = [(string) $header->document_date, 1];
                }

                if ($header->status === InvoiceStatus::Reversed->value && $header->reversal_date !== null
                    && $header->reversal_date >= $from && $header->reversal_date <= $to) {
                    $events[] = [(string) $header->reversal_date, -1];
                }

                $own = $own->values();
                $netLocal = array_values($own->map(static fn (object $l): BigDecimal => Num::dec($l->net_local))->all());
                $taxes = array_values($own->map(static fn (object $l): BigDecimal => Num::dec($l->tax_amount))->all());
                $withheld = array_values($own->map(static fn (object $l): BigDecimal => Num::dec($l->withholding_amount))->all());
                $netTotal = array_reduce($netLocal, static fn (BigDecimal $c, BigDecimal $n): BigDecimal => $c->plus($n), BigDecimal::zero());
                // The journal books VAT as total_local minus the lines' net; withheld VAT as the header's local figure.
                $taxShares = self::allocate(Num::dec($header->total_local)->minus($netTotal), $taxes);
                $withholdingShares = self::allocate(Num::dec($header->withholding_total_local), $withheld);

                foreach ($own as $n => $line) {
                    $warehouse = $line->warehouse_id ?? $header->warehouse_id;

                    if (! $this->matches($f, (string) $line->item_id, is_string($warehouse) ? $warehouse : null)) {
                        continue;
                    }

                    foreach ($events as [$date, $sign]) {
                        $sink(new PurchaseFact(
                            $date, $sign, $header->invoice_type === InvoiceType::Return->value, (string) $header->id,
                            (string) $header->party_id, (string) $header->party_name, (string) $header->currency_code,
                            (string) $line->item_id, (string) $line->item_type, is_string($warehouse) ? $warehouse : null,
                            Num::dec($line->base_quantity), Num::dec($line->net_amount), $netLocal[$n], $taxShares[$n], $withholdingShares[$n],
                        ));
                    }
                }
            }
        }, 'i.id', 'id');
    }

    private function headers(ReportFilters $f): Builder
    {
        $from = (string) $f->dateFrom;
        $to = (string) $f->dateTo;

        return DB::table('purchase_invoices as i')
            ->where('i.company_id', $f->companyId)
            ->whereIn('i.status', [...InvoiceStatus::booked(), InvoiceStatus::Reversed->value])
            ->where(fn (Builder $q) => $q->whereBetween('i.document_date', [$from, $to])
                ->orWhere(fn (Builder $r) => $r->where('i.status', InvoiceStatus::Reversed->value)->whereBetween('i.reversal_date', [$from, $to])))
            ->when($f->partyId !== null, fn (Builder $q) => $q->where('i.party_id', $f->partyId))
            ->when($f->currencyCode !== null, fn (Builder $q) => $q->where('i.currency_code', $f->currencyCode))
            ->when($f->itemId !== null, fn (Builder $q) => $q->whereExists(fn (Builder $e) => $e->selectRaw('1')->from('purchase_invoice_lines as fl')
                ->whereColumn('fl.document_id', 'i.id')->where('fl.company_id', $f->companyId)->where('fl.item_id', $f->itemId)))
            ->select(['i.id', 'i.status', 'i.invoice_type', 'i.document_date', 'i.reversal_date', 'i.party_id', 'i.party_name',
                'i.currency_code', 'i.warehouse_id', 'i.total_local', 'i.withholding_total_local']);
    }

    private function matches(ReportFilters $f, string $itemId, ?string $warehouseId): bool
    {
        return ($f->itemId === null || $f->itemId === $itemId)
            && ($f->warehouseId === null || $f->warehouseId === $warehouseId)
            && ($f->categoryId === null || $this->items->categoryOf($itemId) === $f->categoryId);
    }

    /**
     * @param  list<BigDecimal>  $weights
     * @return list<BigDecimal>
     */
    private static function allocate(BigDecimal $total, array $weights): array
    {
        $sum = array_reduce($weights, static fn (BigDecimal $c, BigDecimal $w): BigDecimal => $c->plus($w), BigDecimal::zero());

        if ($sum->isZero()) {
            // Nothing to weigh by: the whole amount sits on the first line.
            return array_map(static fn (int $i): BigDecimal => $i === 0 ? RoundingPolicy::currency($total) : BigDecimal::zero(), array_keys($weights));
        }

        return RoundingPolicy::allocate($total, $weights);
    }
}
