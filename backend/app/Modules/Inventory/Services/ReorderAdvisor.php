<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Inventory\Events\StockBelowReorderPoint;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Items whose available stock (all warehouses: on hand - reserved) is at or below their reorder
 * point. Suggested quantity = reorder point + minimum stock - available. Reads min_stock and
 * reorder_point from the Catalog items table by column name (ItemData does not carry them).
 */
final class ReorderAdvisor
{
    public const string PERMISSION = 'inventory.stock.view';

    public function __construct(
        private readonly CompanyContext $company,
        private readonly CompanyDirectory $directory,
        private readonly CompanyAuthorizer $authorizer,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @return list<array{item_id: string, item_code: string, item_name: string, base_unit_id: string, on_hand: string, reserved: string, available: string, reorder_point: string, min_stock: string, suggested_quantity: string}>
     */
    public function suggestions(string $companyId, ?string $q = null): array
    {
        $rows = DB::table('items as i')
            ->leftJoinSub(
                DB::table('stock_balances')->where('company_id', $companyId)->groupBy('item_id')->selectRaw('item_id, sum(on_hand) as on_hand, sum(reserved) as reserved'),
                'b', 'b.item_id', '=', 'i.id',
            )
            ->where('i.company_id', $companyId)->whereNull('i.deleted_at')->where('i.is_active', true)->where('i.type', 'stock')
            ->whereNotNull('i.reorder_point')
            ->whereRaw('coalesce(b.on_hand, 0) - coalesce(b.reserved, 0) <= i.reorder_point')
            ->when($q !== null && $q !== '', fn ($w) => $w->where(fn ($s) => $s->where('i.code', 'ilike', '%'.addcslashes((string) $q, '%_\\').'%')->orWhere('i.name', 'ilike', '%'.addcslashes((string) $q, '%_\\').'%')))
            ->orderBy('i.code')
            ->limit(5000)
            ->get(['i.id', 'i.code', 'i.name', 'i.base_unit_id', 'i.reorder_point', 'i.min_stock', 'b.on_hand', 'b.reserved']);

        return array_values($rows->map(static function (stdClass $r): array {
            $onHand = Stock::dec(is_string($r->on_hand) ? $r->on_hand : '0');
            $reserved = Stock::dec(is_string($r->reserved) ? $r->reserved : '0');
            $available = $onHand->minus($reserved);
            $point = Stock::dec((string) $r->reorder_point);
            $min = Stock::dec(is_string($r->min_stock) ? $r->min_stock : '0');
            $suggested = $point->plus($min)->minus($available);

            return [
                'item_id' => (string) $r->id, 'item_code' => (string) $r->code, 'item_name' => (string) $r->name, 'base_unit_id' => (string) $r->base_unit_id,
                'on_hand' => Stock::qty($onHand), 'reserved' => Stock::qty($reserved), 'available' => Stock::qty($available),
                'reorder_point' => Stock::qty($point), 'min_stock' => Stock::qty($min),
                'suggested_quantity' => Stock::qty($suggested->isNegative() ? BigDecimal::zero() : $suggested),
            ];
        })->all());
    }

    /**
     * Emits StockBelowReorderPoint per item and one notification per user holding the stock view
     * permission; returns the number of items below their reorder point.
     */
    public function check(string $companyId): int
    {
        return $this->company->runAs($companyId, function () use ($companyId): int {
            $items = $this->suggestions($companyId);

            if ($items === []) {
                return 0;
            }

            foreach ($items as $item) {
                event(new StockBelowReorderPoint($companyId, $item['item_id'], $item['available'], $item['reorder_point'], $item['suggested_quantity']));
            }

            $query = User::query();
            $this->directory->constrainToMembers($query, $companyId, 'id', activeOnly: true);
            $codes = implode(', ', array_slice(array_column($items, 'item_code'), 0, 10));

            foreach ($query->get() as $user) {
                if ($this->authorizer->allows($user, self::PERMISSION, $companyId)) {
                    $this->notifier->notify($user->id, 'inventory.reorder', [
                        'title' => Messages::get('reorder_title', ['count' => count($items)]),
                        'body' => Messages::get('reorder_body', ['items' => $codes]),
                        'url' => '/inventory/reorder',
                    ]);
                }
            }

            return count($items);
        });
    }
}
