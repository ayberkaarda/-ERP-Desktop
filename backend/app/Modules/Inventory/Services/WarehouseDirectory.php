<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Inventory\Contracts\WarehouseLookup;
use App\Modules\Inventory\Data\WarehouseData;
use App\Modules\Inventory\Enums\ReservationPolicy;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

/**
 * Reads the Reference warehouse master (tables warehouses and locations, by column name only, as
 * the integrity audit does) joined with the inventory settings of each warehouse.
 */
final class WarehouseDirectory implements WarehouseLookup
{
    public function __construct(private readonly CompanyContext $company) {}

    public function find(string $warehouseId): ?WarehouseData
    {
        if (! Str::isUuid($warehouseId)) {
            return null;
        }

        $row = $this->query()->where('w.id', $warehouseId)->first();

        return $row === null ? null : self::data($row);
    }

    public function default(): ?WarehouseData
    {
        $row = $this->query()->where('w.is_default', true)->first();

        return $row === null ? null : self::data($row);
    }

    /**
     * @return list<WarehouseData>
     */
    public function all(): array
    {
        return array_values($this->query()->orderBy('w.code')->get()->map(static fn (stdClass $r): WarehouseData => self::data($r))->all());
    }

    public function locationBelongsTo(string $locationId, string $warehouseId): bool
    {
        return Str::isUuid($locationId) && DB::table('locations')
            ->where('id', $locationId)->where('warehouse_id', $warehouseId)
            ->where('company_id', $this->company->id())->whereNull('deleted_at')->exists();
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array{code: string, name: string}>
     */
    public function locations(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $rows = DB::table('locations')->whereIn('id', array_values(array_unique($ids)))->where('company_id', $this->company->id())->get(['id', 'code', 'name']);
        $map = [];

        foreach ($rows as $row) {
            $map[(string) $row->id] = ['code' => (string) $row->code, 'name' => (string) $row->name];
        }

        return $map;
    }

    public function locationByCode(string $warehouseId, string $code): ?string
    {
        $id = DB::table('locations')->where('warehouse_id', $warehouseId)->where('company_id', $this->company->id())
            ->whereNull('deleted_at')->where('code', $code)->value('id');

        return is_string($id) ? $id : null;
    }

    public function hasMovements(string $warehouseId): bool
    {
        return Str::isUuid($warehouseId) && DB::table('stock_movements')
            ->where('company_id', $this->company->id())->where('warehouse_id', $warehouseId)->exists();
    }

    private function query(): Builder
    {
        return DB::table('warehouses as w')
            ->leftJoin('stock_warehouse_settings as s', 's.warehouse_id', '=', 'w.id')
            ->where('w.company_id', $this->company->id())
            ->whereNull('w.deleted_at')
            ->select(['w.id', 'w.company_id', 'w.code', 'w.name', 'w.is_active', 'w.is_default', 'w.negative_stock_policy', 's.reservation_policy', 's.version as settings_version']);
    }

    private static function data(stdClass $row): WarehouseData
    {
        $policy = is_string($row->negative_stock_policy ?? null) ? $row->negative_stock_policy : 'block';

        return new WarehouseData(
            (string) $row->id,
            (string) $row->company_id,
            (string) $row->code,
            (string) $row->name,
            (bool) $row->is_active,
            (bool) $row->is_default,
            $policy,
            in_array($policy, ['allow', 'warn'], true),
            ReservationPolicy::tryFrom(is_string($row->reservation_policy ?? null) ? $row->reservation_policy : '') ?? ReservationPolicy::Soft,
            is_numeric($row->settings_version ?? null) ? (int) $row->settings_version : 1,
        );
    }
}
