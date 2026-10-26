<?php

declare(strict_types=1);

namespace App\Modules\Parties\Services;

use App\Modules\Parties\Contracts\PartyAddressLookup;
use App\Modules\Parties\Models\PartyAddress;
use Illuminate\Support\Str;

/**
 * Company scoped through BelongsToCompany: addresses of other companies' parties are not found.
 */
final class EloquentPartyAddressLookup implements PartyAddressLookup
{
    public function billingAddress(string $partyId): ?array
    {
        if (! Str::isUuid($partyId)) {
            return null;
        }

        $address = PartyAddress::query()->where('party_id', $partyId)->where('type', 'billing')
            ->orderByDesc('is_default')->orderBy('created_at')->orderBy('id')->first();

        if (! $address instanceof PartyAddress) {
            return null;
        }

        return [
            'label' => $address->label,
            'line1' => $address->line1,
            'line2' => $address->line2,
            'district' => $address->district,
            'city' => $address->city,
            'postal_code' => $address->postal_code,
            'country' => $address->country,
        ];
    }
}
