<?php

declare(strict_types=1);

namespace App\Modules\Sales\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use Illuminate\Database\Eloquent\Model;

/**
 * Abilities map to sales.<resource>.<action>. They are checked with the class (permission only,
 * before lookup or validation) and again with the record (same company).
 */
abstract class SalesPolicy
{
    abstract protected function resource(): string;

    public function viewAny(User $user): bool
    {
        return $this->allowed($user, null, 'view');
    }

    public function view(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'view');
    }

    public function export(User $user): bool
    {
        return $this->allowed($user, null, 'view');
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, null, 'create');
    }

    public function update(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'update');
    }

    public function delete(User $user, ?Model $doc = null): bool
    {
        return $this->allowed($user, $doc, 'delete');
    }

    public static function permits(User $user, string $permission): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        return $company !== null && app(CompanyAuthorizer::class)->allows($user, $permission, $company);
    }

    protected function allowed(User $user, ?Model $model, string $action): bool
    {
        $company = app(CompanyContext::class)->idOrNull();

        if ($company === null || ($model !== null && $model->getAttribute('company_id') !== $company)) {
            return false;
        }

        return app(CompanyAuthorizer::class)->allows($user, 'sales.'.$this->resource().'.'.$action, $company);
    }
}
