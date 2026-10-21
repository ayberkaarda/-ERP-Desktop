<?php

declare(strict_types=1);

namespace App\Modules\Parties\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Parties\Models\Party;

/**
 * Permissions are checked in the active company; a party of another company is never allowed
 * (the company scope already hides it, this is the second line). Addresses, contacts and bank
 * accounts are read with parties.view and written with parties.update.
 */
final class PartyPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, 'parties.view');
    }

    public function view(User $user, Party $party): bool
    {
        return $this->owns($party) && $this->allowed($user, 'parties.view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, 'parties.create');
    }

    public function update(User $user, Party $party): bool
    {
        return $this->owns($party) && $this->allowed($user, 'parties.update');
    }

    public function delete(User $user, Party $party): bool
    {
        return $this->owns($party) && $this->allowed($user, 'parties.delete');
    }

    public function export(User $user): bool
    {
        return $this->allowed($user, 'parties.export');
    }

    private function owns(Party $party): bool
    {
        return $party->company_id === app(CompanyContext::class)->idOrNull();
    }

    private function allowed(User $user, string $permission): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        return $company !== null && app(CompanyAuthorizer::class)->allows($user, $permission, $company);
    }
}
