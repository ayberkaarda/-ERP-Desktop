<?php

declare(strict_types=1);

namespace App\Modules\Reference\Repositories;

use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\Location;
use App\Modules\Reference\Models\Warehouse;
use App\Modules\Reference\Services\ReferenceSchema;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class ReferenceRepository
{
    /** Selected next to each currency row: the active company's activation (no query per row). */
    public const string ACTIVE = 'company_activation_is_active';

    public const string VERSION = 'company_activation_version';

    /** @return Builder<Model> */
    public function query(string $resource, ?string $warehouseId = null): Builder
    {
        $class = ReferenceSchema::model($resource);
        $query = $class::query();
        if ($class === Location::class) {
            Warehouse::query()->findOrFail($warehouseId);
            $query->where('warehouse_id', $warehouseId);
        }
        if ($class === Currency::class) {
            $query->select('currencies.*')->addSelect([
                self::ACTIVE => $this->activation()->select('is_active'),
                self::VERSION => $this->activation()->select('version'),
            ]);
        }

        return $query;
    }

    /**
     * Currencies the active company has switched on (true) or not (false: no row or inactive).
     *
     * @param  Builder<Model>  $query
     */
    public function whereCompanyActive(Builder $query, bool $active): void
    {
        $exists = $this->activation()->where('is_active', true)->select('id');
        $active ? $query->whereExists($exists->toBase()) : $query->whereNotExists($exists->toBase());
    }

    /** @return Builder<CompanyCurrency> */
    private function activation(): Builder
    {
        // Company scoped through BelongsToCompany; soft deleted activations do not count.
        return CompanyCurrency::query()->whereColumn('company_currencies.currency_code', 'currencies.code')->limit(1);
    }
}
