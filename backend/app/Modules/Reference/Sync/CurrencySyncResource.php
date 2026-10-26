<?php

declare(strict_types=1);

namespace App\Modules\Reference\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\CompanyCurrency;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Repositories\ReferenceRepository;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\JoinClause;

final class CurrencySyncResource implements SyncResource
{
    public function name(): string
    {
        return 'currencies';
    }

    public function table(): string
    {
        return 'currencies';
    }

    public function scope(): SyncScope
    {
        return SyncScope::GlobalWithCompanyActivation;
    }

    /** @return Builder<Model> */
    public function query(string $companyId): Builder
    {
        $activation = CompanyCurrency::query()->withoutCompanyScope()
            ->where('company_currencies.company_id', $companyId)
            ->whereColumn('company_currencies.currency_code', 'currencies.code')->limit(1);

        // Deleted activations still advance this company's stream, with inactive REST state.
        $positions = CompanyCurrency::query()->withoutCompanyScope()->withTrashed()
            ->where('company_currencies.company_id', $companyId)
            ->selectRaw('DISTINCT ON (currency_code) currency_code, sync_txid')
            ->orderBy('currency_code')->orderByDesc('sync_txid');

        /** @var Builder<Model> */
        return Currency::query()->select('currencies.*')
            ->leftJoinSub($positions, 'company_currency_sync', function (JoinClause $join): void {
                $join->on('company_currency_sync.currency_code', '=', 'currencies.code');
            })
            ->addSelect([
                ReferenceRepository::ACTIVE => (clone $activation)->select('is_active'),
                ReferenceRepository::VERSION => (clone $activation)->select('version'),
            ]);
    }

    public function positionColumn(): string
    {
        return 'GREATEST(currencies.sync_txid, company_currency_sync.sync_txid)';
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
