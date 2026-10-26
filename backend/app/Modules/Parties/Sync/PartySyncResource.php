<?php

declare(strict_types=1);

namespace App\Modules\Parties\Sync;

use App\Core\Sync\Contracts\SyncResource;
use App\Core\Sync\SyncScope;
use App\Modules\Parties\Http\Resources\PartyResource;
use App\Modules\Parties\Models\Party;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Read side of the `parties` offline resource: live parties of the company with addresses,
 * contacts and bank accounts embedded. Child changes move the party's sync position (child
 * triggers of the 2027_08_01_200100 migration), so a pulled party is always complete.
 */
final class PartySyncResource implements SyncResource
{
    public const string NAME = 'parties';

    public function name(): string
    {
        return self::NAME;
    }

    public function table(): string
    {
        return 'parties';
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
        return Party::query()
            ->withoutCompanyScope()
            ->where('parties.company_id', $companyId)
            ->with($this->embeds());
    }

    public function positionColumn(): string
    {
        return 'parties.sync_txid';
    }

    public function resourceClass(): string
    {
        return PartyResource::class;
    }

    public function embeds(): array
    {
        return ['addresses', 'contacts', 'bankAccounts'];
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
