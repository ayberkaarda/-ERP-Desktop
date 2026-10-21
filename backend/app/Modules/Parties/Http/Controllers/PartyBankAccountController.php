<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Controllers;

use App\Modules\Parties\Http\Requests\BankAccountRequest;
use App\Modules\Parties\Http\Resources\PartyBankAccountResource;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyBankAccount;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;

/** @extends PartyChildController<PartyBankAccount> */
final class PartyBankAccountController extends PartyChildController
{
    public function store(BankAccountRequest $request, string $party): JsonResponse
    {
        return $this->storeFrom($request, $party);
    }

    public function update(BankAccountRequest $request, string $party, string $child): JsonResponse
    {
        return $this->updateFrom($request, $party, $child);
    }

    protected function model(): string
    {
        return PartyBankAccount::class;
    }

    protected function resource(): string
    {
        return PartyBankAccountResource::class;
    }

    protected function relation(Party $party): HasMany
    {
        return $party->bankAccounts();
    }
}
