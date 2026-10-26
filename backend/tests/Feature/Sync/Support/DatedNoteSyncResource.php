<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class DatedNoteSyncResource implements SyncResource
{
    public const string NAME = 'fixture-dated-notes';

    public function name(): string
    {
        return self::NAME;
    }

    public function table(): string
    {
        return DatedNote::TABLE;
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
        /** @var Builder<Model> */
        return DatedNote::query()->withoutCompanyScope()->where(DatedNote::TABLE.'.company_id', $companyId);
    }

    public function positionColumn(): string
    {
        return DatedNote::TABLE.'.sync_txid';
    }

    public function resourceClass(): string
    {
        return DatedNoteResource::class;
    }

    public function embeds(): array
    {
        return [];
    }

    public function windowField(): ?string
    {
        return 'note_date';
    }

    public function parentKey(): ?string
    {
        return null;
    }
}
