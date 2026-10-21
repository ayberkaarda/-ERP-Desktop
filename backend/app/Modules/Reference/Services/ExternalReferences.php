<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

final class ExternalReferences
{
    public const string BRANCH_LOOKUP = 'App\Modules\Organization\Contracts\BranchLookup';

    public const string PARTY_LOOKUP = 'App\Modules\Parties\Contracts\PartyLookup';

    public function branchExists(string $id): bool
    {
        return $this->invoke(self::BRANCH_LOOKUP, 'exists', $id) === true;
    }

    public function partyExists(string $id): bool
    {
        $party = $this->invoke(self::PARTY_LOOKUP, 'find', $id);

        return $party !== null && $party !== false;
    }

    private function invoke(string $contract, string $method, string $id): mixed
    {
        $lookup = app()->make($contract);
        $callback = [$lookup, $method];

        return is_callable($callback) ? $callback($id) : null;
    }
}
