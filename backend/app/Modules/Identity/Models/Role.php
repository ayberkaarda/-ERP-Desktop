<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;
use Spatie\Permission\Models\Role as SpatieRole;

/**
 * A role always belongs to one company (spatie team = company).
 *
 * @property string $id
 * @property string $company_id
 * @property string $name
 * @property string $guard_name
 * @property string|null $description
 * @property bool $is_system
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class Role extends SpatieRole
{
    use BelongsToCompany;
    use HasUuid7;
    use LogsActivity;

    public const string ADMIN = 'Admin';

    protected $casts = ['is_system' => 'boolean'];

    public function getMorphClass(): string
    {
        return 'role';
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['name', 'description'])
            ->logOnlyDirty()
            ->dontLogEmptyChanges();
    }
}
