<?php

declare(strict_types=1);

namespace App\Modules\Organization\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use App\Modules\Organization\Database\factories\BranchFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 * @property string $code
 * @property string $name
 * @property string|null $phone
 * @property string|null $address
 * @property bool $is_active
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class Branch extends Model
{
    use BelongsToCompany;

    /** @use HasFactory<BranchFactory> */
    use HasFactory;

    use HasUuid7;
    use LogsActivity;
    use SoftDeletes;

    public const array FIELDS = ['code', 'name', 'phone', 'address', 'is_active'];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true];

    public function getMorphClass(): string
    {
        return 'branch';
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(self::FIELDS)->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): BranchFactory
    {
        return BranchFactory::new();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }
}
