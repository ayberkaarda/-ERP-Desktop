<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Inventory\Support\InventorySettings;
use App\Modules\Inventory\Support\Stock;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Recomputes stock_valuations and stock_balances of a company from the movements (on hand, value)
 * and the active reservations (reserved). The average of a pair becomes value / quantity; a pair
 * without stock keeps its stored average. Runs under a share lock on the movements so no posting
 * interleaves.
 */
final class BalanceRebuilder
{
    public function __construct(
        private readonly CompanyContext $company,
        private readonly InventorySettings $settings,
    ) {}

    /**
     * Differences between the stored balances and the movements (empty when consistent).
     *
     * @return list<array{item_id: string, warehouse_id: string, location_id: string, lot_id: string, stored: string, computed: string}>
     */
    public function differences(string $companyId): array
    {
        $rows = DB::select(<<<'SQL'
            SELECT coalesce(b.item_id, m.item_id) AS item_id, coalesce(b.warehouse_id, m.warehouse_id) AS warehouse_id,
                   coalesce(b.location_id, m.location_id) AS location_id, coalesce(b.lot_id, m.lot_id) AS lot_id,
                   coalesce(b.on_hand, 0) AS stored, coalesce(m.qty, 0) AS computed
            FROM (SELECT * FROM stock_balances WHERE company_id = ?) b
            FULL JOIN (
                SELECT item_id, warehouse_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid) AS location_id,
                       coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) AS lot_id,
                       sum(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) AS qty
                FROM stock_movements WHERE company_id = ?
                GROUP BY 1, 2, 3, 4
            ) m ON m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id AND m.location_id = b.location_id AND m.lot_id = b.lot_id
            WHERE coalesce(b.on_hand, 0) <> coalesce(m.qty, 0)
            ORDER BY 1, 2, 3, 4
            SQL, [$companyId, $companyId]);

        return array_values(array_map(static fn (stdClass $r): array => [
            'item_id' => (string) $r->item_id, 'warehouse_id' => (string) $r->warehouse_id,
            'location_id' => (string) $r->location_id, 'lot_id' => (string) $r->lot_id,
            'stored' => Stock::qty((string) $r->stored), 'computed' => Stock::qty((string) $r->computed),
        ], $rows));
    }

    /**
     * @return array{balances: int, valuations: int}
     */
    public function rebuild(string $companyId): array
    {
        $scale = $this->company->runAs($companyId, fn (): int => $this->settings->costScale());

        return DB::transaction(function () use ($companyId, $scale): array {
            DB::statement('LOCK TABLE stock_movements IN SHARE MODE');
            DB::statement('LOCK TABLE stock_reservations IN SHARE MODE');

            DB::statement(<<<'SQL'
                INSERT INTO stock_valuations (company_id, item_id, warehouse_id, quantity, value, avg_cost, updated_at)
                SELECT company_id, item_id, warehouse_id,
                       sum(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END),
                       sum(CASE WHEN direction = 'in' THEN total_cost ELSE -total_cost END), 0, now()
                FROM stock_movements WHERE company_id = ?
                GROUP BY company_id, item_id, warehouse_id
                ON CONFLICT (company_id, item_id, warehouse_id) DO UPDATE SET
                    quantity = excluded.quantity, value = excluded.value, updated_at = now()
                SQL, [$companyId]);
            DB::update('UPDATE stock_valuations SET avg_cost = round(value / quantity, ?) WHERE company_id = ? AND quantity > 0', [$scale, $companyId]);
            $valuations = DB::table('stock_valuations')->where('company_id', $companyId)->count();

            DB::table('stock_balances')->where('company_id', $companyId)->delete();
            $balances = DB::affectingStatement(<<<'SQL'
                INSERT INTO stock_balances (company_id, item_id, warehouse_id, location_id, lot_id, on_hand, reserved, updated_at)
                SELECT ?, item_id, warehouse_id, location_id, lot_id, sum(on_hand), sum(reserved), now()
                FROM (
                    SELECT item_id, warehouse_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid) AS location_id,
                           coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid) AS lot_id,
                           CASE WHEN direction = 'in' THEN quantity ELSE -quantity END AS on_hand, 0 AS reserved
                    FROM stock_movements WHERE company_id = ?
                    UNION ALL
                    SELECT item_id, warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid,
                           coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid), 0, quantity
                    FROM stock_reservations WHERE company_id = ? AND status = 'active'
                ) x
                GROUP BY item_id, warehouse_id, location_id, lot_id
                SQL, [$companyId, $companyId, $companyId]);
            DB::update(<<<'SQL'
                UPDATE stock_balances b SET avg_cost = v.avg_cost, value = round(b.on_hand * v.avg_cost, 4)
                FROM stock_valuations v
                WHERE b.company_id = ? AND v.company_id = b.company_id AND v.item_id = b.item_id AND v.warehouse_id = b.warehouse_id
                SQL, [$companyId]);
            // Rows whose final state is negative were allowed when posted; judge them now, not at commit.
            DB::statement('SET CONSTRAINTS '.Stock::DEFERRED.' IMMEDIATE');

            return ['balances' => $balances, 'valuations' => $valuations];
        });
    }
}
