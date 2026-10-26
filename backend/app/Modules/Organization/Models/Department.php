<?php

declare(strict_types=1);

namespace App\Modules\Organization\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use App\Modules\Organization\Database\factories\DepartmentFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 * @property string|null $branch_id
 * @property string|null $parent_id
 * @property string|null $manager_user_id
 * @property string $code
 * @property string $name
 * @property bool $is_active
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class Department extends Model
{
    use BelongsToCompany;

    /** @use HasFactory<DepartmentFactory> */
    use HasFactory;

    use HasUuid7;
    use LogsActivity;
    use SoftDeletes;

    public const array FIELDS = ['code', 'name', 'branch_id', 'parent_id', 'manager_user_id', 'is_active'];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true];

    public function getMorphClass(): string
    {
        return 'department';
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(self::FIELDS)->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): DepartmentFactory
    {
        return DepartmentFactory::new();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }
}
