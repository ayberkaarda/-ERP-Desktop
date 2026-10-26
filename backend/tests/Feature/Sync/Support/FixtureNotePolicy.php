<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use Illuminate\Database\Eloquent\Model;

/**
 * Policy of the fixture notes, written like a module policy: permission in the active company,
 * and a row of another company is never allowed.
 */
final class FixtureNotePolicy
{
    public function viewAny(User $user): bool
    {
        return $this->allowed($user, 'fixtures.view');
    }

    public function view(User $user, Model $note): bool
    {
        return $this->owns($note) && $this->allowed($user, 'fixtures.view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, 'fixtures.create');
    }

    public function update(User $user, Model $note): bool
    {
        return $this->owns($note) && $this->allowed($user, 'fixtures.update');
    }

    public function delete(User $user, Model $note): bool
    {
        return $this->owns($note) && $this->allowed($user, 'fixtures.delete');
    }

    private function owns(Model $note): bool
    {
        return $note->getAttribute('company_id') === app(CompanyContext::class)->idOrNull();
    }

    private function allowed(User $user, string $permission): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        return $company !== null && app(CompanyAuthorizer::class)->allows($user, $permission, $company);
    }
}
