<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Read adapter for the `fixture-notes` resource, written the way a module adapter would be.
 */
final class FixtureNoteSyncResource implements SyncResource
{
    public const string NAME = 'fixture-notes';

    public function name(): string
    {
        return self::NAME;
    }

    public function table(): string
    {
        return 'sync_fixture_notes';
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
        return FixtureNote::query()
            ->withoutCompanyScope()
            ->where('sync_fixture_notes.company_id', $companyId)
            ->with($this->embeds());
    }

    public function positionColumn(): string
    {
        return 'sync_fixture_notes.sync_txid';
    }

    public function resourceClass(): string
    {
        return FixtureNoteResource::class;
    }

    public function embeds(): array
    {
        return ['lines'];
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
