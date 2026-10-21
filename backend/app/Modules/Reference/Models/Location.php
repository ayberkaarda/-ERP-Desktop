<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use App\Modules\Reference\Database\factories\LocationFactory;
use App\Modules\Reference\Enums\LocationType;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 */
class Location extends Model
{
    use BelongsToCompany;

    /** @use HasFactory<LocationFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'locations';

    /** @var list<string> */
    protected $fillable = ['warehouse_id', 'code', 'name', 'parent_id', 'type', 'is_active', 'barcode'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): LocationFactory
    {
        return LocationFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'type' => LocationType::class,
        ];
    }
}
