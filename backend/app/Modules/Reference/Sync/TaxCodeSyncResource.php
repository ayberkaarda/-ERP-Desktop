<?php

declare(strict_types=1);

namespace App\Modules\Reference\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\TaxCode;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class TaxCodeSyncResource implements SyncResource
{
    public function name(): string
    {
        return 'tax-codes';
    }

    public function table(): string
    {
        return 'tax_codes';
    }

    public function scope(): SyncScope
    {
        return SyncScope::CompanyOrGlobal;
    }

    /** @return Builder<Model> */
    public function query(string $companyId): Builder
    {
        /** @var Builder<Model> */
        return TaxCode::query()->withoutGlobalScope('visible')
            ->where(function (Builder $query) use ($companyId): void {
                $query->whereNull('tax_codes.company_id')->orWhere('tax_codes.company_id', $companyId);
            });
    }

    public function positionColumn(): string
    {
        return 'tax_codes.sync_txid';
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
