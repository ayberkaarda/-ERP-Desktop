<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Company\CompanyScope;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Spatie\Permission\Models\Permission as SpatiePermission;

/**
 * Global permission catalog entry; names are `<resource>.<action>`.
 *
 * @property string $id
 * @property string $name
 * @property string $guard_name
 * @property string $module
 */
class Permission extends SpatiePermission
{
    use HasUuid7;

    /**
     * The registrar caches every permission with all its roles once; that cache must not depend
     * on which company happens to be active when it is built.
     *
     * @return BelongsToMany<Model, $this>
     */
    public function roles(): BelongsToMany
    {
        return parent::roles()->withoutGlobalScope(CompanyScope::class);
    }
}
