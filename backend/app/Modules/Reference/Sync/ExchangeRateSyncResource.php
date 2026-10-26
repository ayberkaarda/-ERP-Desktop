<?php

declare(strict_types=1);

namespace App\Modules\Reference\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\ExchangeRate;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class ExchangeRateSyncResource implements SyncResource
{
    public function name(): string
    {
        return 'exchange-rates';
    }

    public function table(): string
    {
        return 'exchange_rates';
    }

    public function scope(): SyncScope
    {
        return SyncScope::CompanyOrGlobal;
    }

    /** @return Builder<Model> */
    public function query(string $companyId): Builder
    {
        /** @var Builder<Model> */
        return ExchangeRate::query()->withoutGlobalScope('visible')
            ->where(function (Builder $query) use ($companyId): void {
                $query->whereNull('exchange_rates.company_id')->orWhere('exchange_rates.company_id', $companyId);
            });
    }

    public function positionColumn(): string
    {
        return 'exchange_rates.sync_txid';
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
        return 'rate_date';
    }

    public function parentKey(): ?string
    {
        return null;
    }
}
