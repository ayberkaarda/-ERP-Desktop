<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Controllers;

use App\Modules\Parties\Http\Requests\ContactRequest;
use App\Modules\Parties\Http\Resources\PartyContactResource;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyContact;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;

/** @extends PartyChildController<PartyContact> */
final class PartyContactController extends PartyChildController
{
    public function store(ContactRequest $request, string $party): JsonResponse
    {
        return $this->storeFrom($request, $party);
    }

    public function update(ContactRequest $request, string $party, string $child): JsonResponse
    {
        return $this->updateFrom($request, $party, $child);
    }

    protected function model(): string
    {
        return PartyContact::class;
    }

    protected function resource(): string
    {
        return PartyContactResource::class;
    }

    protected function relation(Party $party): HasMany
    {
        return $party->contacts();
    }
}
