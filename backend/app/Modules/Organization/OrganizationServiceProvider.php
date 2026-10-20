<?php

declare(strict_types=1);

namespace App\Modules\Organization;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Identity\Contracts\PermissionRegistry;
use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Organization\Models\Branch;
use App\Modules\Organization\Models\Company;
use App\Modules\Organization\Models\Department;
use App\Modules\Organization\Policies\BranchPolicy;
use App\Modules\Organization\Policies\CompanyPolicy;
use App\Modules\Organization\Policies\DepartmentPolicy;
use App\Modules\Organization\Services\DatabaseCompanyDirectory;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Facades\Gate;

final class OrganizationServiceProvider extends ModuleServiceProvider
{
    public const array PERMISSIONS = [
        'companies.view', 'companies.update', 'companies.delete',
        'branches.view', 'branches.create', 'branches.update', 'branches.delete',
        'departments.view', 'departments.create', 'departments.update', 'departments.delete',
    ];

    public function register(): void
    {
        $this->app->singleton(CompanyDirectory::class, DatabaseCompanyDirectory::class);

        $this->callAfterResolving(PermissionRegistry::class, static function (PermissionRegistry $registry): void {
            $registry->register('organization', self::PERMISSIONS);
        });
    }

    public function boot(): void
    {
        $this->bootModule();

        Relation::morphMap(['company' => Company::class, 'branch' => Branch::class, 'department' => Department::class]);

        Gate::policy(Company::class, CompanyPolicy::class);
        Gate::policy(Branch::class, BranchPolicy::class);
        Gate::policy(Department::class, DepartmentPolicy::class);
    }
}
