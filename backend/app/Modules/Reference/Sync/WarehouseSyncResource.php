<?php

declare(strict_types=1);

namespace App\Modules\Reference\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\Warehouse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class WarehouseSyncResource implements SyncResource
{
    public function name(): string
    {
        return 'warehouses';
    }

    public function table(): string
    {
        return 'warehouses';
    }

    public function scope(): SyncScope
    {
        return SyncScope::Company;
    }

    /** @return Builder<Model> */
    public function query(string $companyId): Builder
    {
        /** @var Builder<Model> */
        return Warehouse::query()->withoutCompanyScope()->where('warehouses.company_id', $companyId);
    }

    public function positionColumn(): string
    {
        return 'warehouses.sync_txid';
    }

    public function resourceClass(): string
    {
        return ReferenceResource::class;
    }

    public function embeds(): array
    {
        return [];
    }

    public function windowField(): ?string
    {
        return null;
    }

    public function parentKey(): ?string
    {
        return null;
    }
}
