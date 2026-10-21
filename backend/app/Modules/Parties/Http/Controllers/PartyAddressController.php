<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Controllers;

use App\Modules\Parties\Http\Requests\AddressRequest;
use App\Modules\Parties\Http\Resources\PartyAddressResource;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyAddress;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;

/** @extends PartyChildController<PartyAddress> */
final class PartyAddressController extends PartyChildController
{
    public function store(AddressRequest $request, string $party): JsonResponse
    {
        return $this->storeFrom($request, $party);
    }

    public function update(AddressRequest $request, string $party, string $child): JsonResponse
    {
        return $this->updateFrom($request, $party, $child);
    }

    protected function model(): string
    {
        return PartyAddress::class;
    }

    protected function resource(): string
    {
        return PartyAddressResource::class;
    }

    protected function relation(Party $party): HasMany
    {
        return $party->addresses();
    }

    /** The address country defaults to the country of the party. */
    protected function defaults(Party $party, array $data): array
    {
        return ['country' => $party->country, ...$data];
    }
}
