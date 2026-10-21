<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use App\Modules\Reference\Database\factories\CostCenterFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 */
class CostCenter extends Model
{
    use BelongsToCompany;

    /** @use HasFactory<CostCenterFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'cost_centers';

    /** @var list<string> */
    protected $fillable = ['code', 'name', 'parent_id', 'is_active'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): CostCenterFactory
    {
        return CostCenterFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
