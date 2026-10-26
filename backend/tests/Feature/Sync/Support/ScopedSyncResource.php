<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Read adapters of the scope fixtures: `fixture-rates` (company_or_global over SharedRate) and
 * `fixture-tags` (global rows over GlobalTag). Like module adapters, the query applies the
 * scope; tombstones are left to the pull service.
 */
final readonly class ScopedSyncResource implements SyncResource
{
    public function __construct(private string $name) {}

    public static function rates(): self
    {
        return new self('fixture-rates');
    }

    public static function tags(): self
    {
        return new self('fixture-tags');
    }

    public function name(): string
    {
        return $this->name;
    }

    public function table(): string
    {
        return $this->name === 'fixture-rates' ? SharedRate::TABLE : 'sync_fixture_tags';
    }

    public function scope(): SyncScope
    {
        return $this->name === 'fixture-rates' ? SyncScope::CompanyOrGlobal : SyncScope::GlobalWithCompanyActivation;
    }

    /**
     * @return Builder<Model>
     */
    public function query(string $companyId): Builder
    {
        if ($this->name === 'fixture-tags') {
            /** @var Builder<Model> */
            return GlobalTag::query();
        }

        /** @var Builder<Model> */
        return SharedRate::query()->where(fn (Builder $q) => $q->whereNull(SharedRate::TABLE.'.company_id')->orWhere(SharedRate::TABLE.'.company_id', $companyId));
    }

    public function positionColumn(): string
    {
        return $this->table().'.sync_txid';
    }

    public function resourceClass(): string
    {
        return PlainResource::class;
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
