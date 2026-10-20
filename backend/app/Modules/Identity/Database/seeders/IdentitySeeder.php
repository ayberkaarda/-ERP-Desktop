<?php

declare(strict_types=1);

namespace App\Modules\Identity\Database\seeders;

use App\Modules\Identity\Services\DefaultRoles;
use App\Modules\Identity\Services\PermissionCatalog;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Database\Seeder;

/**
 * Syncs the permission catalog and the default roles of every company. Safe to re-run.
 */
class IdentitySeeder extends Seeder
{
    public function run(PermissionCatalog $catalog, DefaultRoles $roles, CompanyDirectory $companies): void
    {
        $catalog->sync();

        foreach ($companies->allActiveCompanies() as $company) {
            $roles->ensureFor($company['id']);
        }
    }
}
