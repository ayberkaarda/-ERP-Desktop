<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Data\RevenueFact;
use App\Modules\Sales\Reports\Support\Num;

/**
 * Returns against sales in the range, from the ledger view of RevenueFacts: credit notes (returns)
 * against sale invoices (sales), both net of reversals. value_rate_percent = returns / sales; per
 * item also the base quantity rate. A credit note counts in its own range, which may differ from the
 * range of the invoice it corrects. Groups: item (default), customer, category; most returned first.
 */
final class ReturnRateReport
{
    public const array GROUPS = ['item', 'customer', 'category'];

    private const array FIGURES = ['invoice_count', 'credit_note_count', 'sales_amount', 'returns_amount', 'value_rate_percent'];

    public function __construct(
        private readonly RevenueFacts $facts,
        private readonly ItemDirectory $items,
    ) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'item' => ['item_id', 'item_code', 'item_name', 'category_id', 'sold_quantity', 'returned_quantity', 'quantity_rate_percent', ...self::FIGURES],
            'customer' => ['party_id', 'party_code', 'party_name', ...self::FIGURES],
            default => ['category_id', ...self::FIGURES],
        };
    }

    public function build(ReportFilters $f, string $by): ReportTable
    {
        if ($by === 'category') {
            $this->items->needCategories();
        }

        /** @var array<string, SalesBucket> $buckets */
        $buckets = [];
        $totals = new RevenueTotals;

        $this->facts->each($f, function (RevenueFact $fact) use (&$buckets, $totals, $by): void {
            $key = match ($by) {
                'item' => $fact->itemId,
                'customer' => $fact->partyId,
                default => $this->items->categoryOf($fact->itemId) ?? '',
            };
            ($buckets[$key] ??= new SalesBucket)->add($fact);
            $totals->add($fact);
        });

        $rows = [];

        foreach ($buckets as $key => $b) {
            $key = (string) $key;
            $a = $b->amounts();
            $figures = [
                'invoice_count' => $a['invoice_count'], 'credit_note_count' => $a['credit_note_count'],
                'sales_amount' => $a['sales_amount'], 'returns_amount' => $a['returns_amount'],
                'value_rate_percent' => Num::percent($b->returns, $b->sales),
            ];
            $rows[] = match ($by) {
                'item' => ['item_id' => $key, 'item_code' => null, 'item_name' => null, 'category_id' => null,
                    'sold_quantity' => Num::qty($b->sold), 'returned_quantity' => Num::qty($b->returned),
                    'quantity_rate_percent' => Num::percent($b->returned, $b->sold), ...$figures],
                'customer' => ['party_id' => $key, 'party_code' => null, 'party_name' => $b->label, ...$figures],
                default => ['category_id' => $key === '' ? null : $key, ...$figures],
            };
        }

        $t = $totals->total;

        return new ReportTable(SalesGroupReport::sortByNet($rows, 'returns_amount'), self::columns($by), [
            'group_by' => $by,
            'totals' => [
                'sales_amount' => Num::money($t->sales),
                'returns_amount' => Num::money($t->returns),
                'value_rate_percent' => Num::percent($t->returns, $t->sales),
            ],
        ]);
    }

    /**
     * @param  list<array<string, string|int|null>>  $rows
     * @return list<array<string, string|int|null>>
     */
    public function decorate(array $rows, string $by): array
    {
        return match ($by) {
            'item' => $this->items->withItems($rows),
            'customer' => $this->items->withParties($rows),
            default => $rows,
        };
    }
}
