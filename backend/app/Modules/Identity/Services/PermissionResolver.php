<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Database\ConnectionInterface;

/**
 * Reads role permissions straight from the spatie tables, so checks never depend on which
 * company is active or on relations cached on a model instance. Memoized per request.
 */
final class PermissionResolver implements CompanyAuthorizer
{
    /** @var array<string, array<string, list<string>>> */
    private array $memo = [];

    public function __construct(
        private readonly ConnectionInterface $db,
        private readonly CompanyDirectory $companies,
        private readonly PermissionCatalog $catalog,
    ) {}

    public function allows(User $user, string $permission, string $companyId): bool
    {
        if (! $user->is_active) {
            return false;
        }

        return in_array($permission, $this->permissionsByCompany($user)[$companyId] ?? [], true);
    }

    public function permissionsByCompany(User $user): array
    {
        if (! $user->is_active) {
            return [];
        }

        return $this->memo[$user->id] ??= $this->load($user);
    }

    /**
     * Role names per company, for the companies the user may enter.
     *
     * @return array<string, list<string>>
     */
    public function roleNamesByCompany(User $user): array
    {
        $rows = $this->db->table('model_has_roles')
            ->join('roles', function ($join): void {
                $join->on('roles.id', '=', 'model_has_roles.role_id')->on('roles.company_id', '=', 'model_has_roles.company_id');
            })
            ->where('model_has_roles.model_type', $user->getMorphClass())
            ->where('model_has_roles.model_id', $user->id)
            ->orderBy('roles.name')
            ->get(['model_has_roles.company_id', 'roles.name']);

        $names = [];

        foreach ($rows as $row) {
            /** @var object{company_id: string, name: string} $row */
            $names[(string) $row->company_id][] = (string) $row->name;
        }

        return $names;
    }

    public function forget(?string $userId = null): void
    {
        if ($userId === null) {
            $this->memo = [];

            return;
        }

        unset($this->memo[$userId]);
    }

    /**
     * @return array<string, list<string>>
     */
    private function load(User $user): array
    {
        if ($user->is_super_admin) {
            $all = $this->catalog->all();
            sort($all);
            $byCompany = [];

            foreach ($this->companies->allActiveCompanies() as $company) {
                $byCompany[$company['id']] = $all;
            }

            return $byCompany;
        }

        $allowed = array_column($this->companies->companiesFor($user->id), 'id');

        if ($allowed === []) {
            return [];
        }

        $rows = $this->db->table('model_has_roles')
            ->join('roles', function ($join): void {
                $join->on('roles.id', '=', 'model_has_roles.role_id')->on('roles.company_id', '=', 'model_has_roles.company_id');
            })
            ->join('role_has_permissions', 'role_has_permissions.role_id', '=', 'roles.id')
            ->join('permissions', 'permissions.id', '=', 'role_has_permissions.permission_id')
            ->where('model_has_roles.model_type', $user->getMorphClass())
            ->where('model_has_roles.model_id', $user->id)
            ->whereIn('model_has_roles.company_id', $allowed)
            ->distinct()
            ->orderBy('permissions.name')
            ->get(['model_has_roles.company_id', 'permissions.name']);

        $byCompany = array_fill_keys($allowed, []);

        foreach ($rows as $row) {
            /** @var object{company_id: string, name: string} $row */
            $byCompany[(string) $row->company_id][] = (string) $row->name;
        }

        return $byCompany;
    }
}
