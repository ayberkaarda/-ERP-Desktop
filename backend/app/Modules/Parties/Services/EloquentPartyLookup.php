<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Modules\Parties\Contracts\PartyLookup;
use App\Modules\Parties\Data\PartyData;
use App\Modules\Parties\Models\Party;
use Illuminate\Support\Str;

/**
 * Company scoped through BelongsToCompany: ids of other companies are simply not found.
 */
final class EloquentPartyLookup implements PartyLookup
{
    public function find(string $id): ?PartyData
    {
        if (! Str::isUuid($id)) {
            return null;
        }

        $party = Party::query()->find($id);

        return $party instanceof Party ? PartyData::fromModel($party) : null;
    }

    public function findMany(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, static fn (string $id): bool => Str::isUuid($id))));
        $found = [];

        foreach (array_chunk($ids, 1000) as $chunk) {
            foreach (Party::query()->whereKey($chunk)->get() as $party) {
                $found[$party->id] = PartyData::fromModel($party);
            }
        }

        return $found;
    }

    public function findByCode(string $code): ?PartyData
    {
        $party = Party::query()->where('code', $code)->first();

        return $party instanceof Party ? PartyData::fromModel($party) : null;
    }

    public function exists(string $id): bool
    {
        return Str::isUuid($id) && Party::query()->whereKey($id)->exists();
    }
}
