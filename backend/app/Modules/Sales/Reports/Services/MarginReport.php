<?php

declare(strict_types=1);

namespace App\Modules\Sales\Reports\Services;

use App\Modules\Sales\Reports\Data\CostFact;
use App\Modules\Sales\Reports\Data\ReportFilters;
use App\Modules\Sales\Reports\Data\ReportTable;
use App\Modules\Sales\Reports\Data\RevenueFact;
use App\Modules\Sales\Reports\Support\Num;
use Brick\Math\BigDecimal;

/**
 * Gross margin of the range in company currency: revenue = net sales (RevenueFacts: invoices minus
 * credit notes, reversals netted) against COGS = the stock cost of the goods that left (CostFacts:
 * posted deliveries minus cancellations of posted deliveries minus received returns), each on its
 * own booking date as in the ledger. Goods delivered in one range and invoiced in another show
 * their cost and revenue in different ranges; services have revenue only.
 * Groups: item (default), customer, category, warehouse (invoice line/header warehouse for revenue,
 * delivery/return warehouse for cost) or month; largest revenue first (months oldest first).
 */
final class MarginReport
{
    public const array GROUPS = ['item', 'customer', 'category', 'warehouse', 'month'];

    private const array FIGURES = ['revenue', 'cogs', 'gross_margin', 'margin_percent'];

    public function __construct(
        private readonly RevenueFacts $revenue,
        private readonly CostFacts $costs,
        private readonly ItemDirectory $items,
    ) {}

    /** @return list<string> */
    public static function columns(string $by): array
    {
        return match ($by) {
            'item' => ['item_id', 'item_code', 'item_name', 'category_id', 'invoiced_quantity', 'delivered_quantity', ...self::FIGURES],
            'customer' => ['party_id', 'party_code', 'party_name', ...self::FIGURES],
            'category' => ['category_id', ...self::FIGURES],
            'warehouse' => ['warehouse_id', ...self::FIGURES],
            default => ['period', ...self::FIGURES],
        };
    }

    public function build(ReportFilters $f, string $by): ReportTable
    {
        if ($by === 'category') {
            $this->items->needCategories();
        }

        /** @var array<string, array{revenue: BigDecimal, cogs: BigDecimal, invoiced: BigDecimal, delivered: BigDecimal, name: string, date: string}> $groups */
        $groups = [];
        $blank = ['revenue' => BigDecimal::zero(), 'cogs' => BigDecimal::zero(), 'invoiced' => BigDecimal::zero(), 'delivered' => BigDecimal::zero(), 'name' => '', 'date' => ''];
        $revenueTotal = BigDecimal::zero();
        $cogsTotal = BigDecimal::zero();

        $this->revenue->each($f, function (RevenueFact $fact) use (&$groups, &$revenueTotal, $blank, $by): void {
            $key = $this->key($by, $fact->itemId, $fact->partyId, $fact->warehouseId, $fact->date);
            $g = $groups[$key] ?? $blank;
            $amount = $fact->signedNetLocal();
            $g['revenue'] = $g['revenue']->plus($amount);
            $g['invoiced'] = $g['invoiced']->plus($fact->baseQuantity->multipliedBy($fact->creditNote ? -$fact->sign : $fact->sign));
            [$g['name'], $g['date']] = $fact->date >= $g['date'] ? [$fact->partyName, $fact->date] : [$g['name'], $g['date']];
            $groups[$key] = $g;
            $revenueTotal = $revenueTotal->plus($amount);
        });

        $this->costs->each($f, function (CostFact $fact) use (&$groups, &$cogsTotal, $blank, $by): void {
            $key = $this->key($by, $fact->itemId, $fact->partyId, $fact->warehouseId, $fact->date);
            $g = $groups[$key] ?? $blank;
            $g['cogs'] = $g['cogs']->plus($fact->cost);
            $g['delivered'] = $g['delivered']->plus($fact->baseQuantity);
            [$g['name'], $g['date']] = $fact->date >= $g['date'] ? [$fact->partyName, $fact->date] : [$g['name'], $g['date']];
            $groups[$key] = $g;
            $cogsTotal = $cogsTotal->plus($fact->cost);
        });

        $rows = [];

        foreach ($groups as $key => $g) {
            $key = (string) $key;
            $id = $key === '' ? null : $key;
            $head = match ($by) {
                'item' => ['item_id' => $id, 'item_code' => null, 'item_name' => null, 'category_id' => null,
                    'invoiced_quantity' => Num::qty($g['invoiced']), 'delivered_quantity' => Num::qty($g['delivered'])],
                'customer' => ['party_id' => $id, 'party_code' => null, 'party_name' => $g['name']],
                'category' => ['category_id' => $id],
                'warehouse' => ['warehouse_id' => $id],
                default => ['period' => $key],
            };
            $rows[] = [...$head, ...self::figures($g['revenue'], $g['cogs'])];
        }

        if ($by === 'month') {
            usort($rows, static fn (array $a, array $b): int => strcmp((string) ($a['period'] ?? ''), (string) ($b['period'] ?? '')));
        } else {
            $rows = SalesGroupReport::sortByNet($rows, 'revenue');
        }

        return new ReportTable($rows, self::columns($by), ['group_by' => $by, 'totals' => self::figures($revenueTotal, $cogsTotal)]);
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

    /** @return array{revenue: string, cogs: string, gross_margin: string, margin_percent: string|null} */
    private static function figures(BigDecimal $revenue, BigDecimal $cogs): array
    {
        $margin = $revenue->minus($cogs);

        return ['revenue' => Num::money($revenue), 'cogs' => Num::money($cogs), 'gross_margin' => Num::money($margin), 'margin_percent' => Num::percent($margin, $revenue)];
    }

    private function key(string $by, string $itemId, string $partyId, ?string $warehouseId, string $date): string
    {
        return match ($by) {
            'item' => $itemId,
            'customer' => $partyId,
            'category' => $this->items->categoryOf($itemId) ?? '',
            'warehouse' => $warehouseId ?? '',
            default => substr($date, 0, 7),
        };
    }
}
