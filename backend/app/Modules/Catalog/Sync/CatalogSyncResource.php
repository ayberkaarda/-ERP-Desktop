<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Catalog\Models\CatalogModel;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Read-only sync adapter of one company scoped catalog table. The REST index and the pull
 * share the Resource class; a subclass names the manifest resource, model and Resource.
 */
abstract class CatalogSyncResource implements SyncResource
{
    /** @return class-string<CatalogModel> */
    abstract protected function model(): string;

    /**
     * Relations to eager load for the manifest embeds.
     *
     * @return list<string>
     */
    protected function with(): array
    {
        return [];
    }

    /**
     * Eager loads that do not depend on the request's active company (a pull may run without one).
     *
     * @return array<string, Closure>
     */
    private function scopedRelations(): array
    {
        $relations = [];

        foreach ($this->with() as $relation) {
            $relations[$relation] = static fn ($query) => $query->withoutCompanyScope();
        }

        return $relations;
    }

    public function scope(): SyncScope
    {
        return SyncScope::Company;
    }

    /**
     * @return Builder<Model>
     */
    public function query(string $companyId): Builder
    {
        $model = $this->model();
        $table = $this->table();

        /** @var Builder<Model> */
        return $model::query()
            ->withoutCompanyScope()
            ->where("{$table}.company_id", $companyId)
            ->with($this->scopedRelations());
    }

    public function positionColumn(): string
    {
        return $this->table().'.sync_txid';
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
