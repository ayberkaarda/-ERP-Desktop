<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use App\Modules\Files\Contracts\Attachable;
use App\Modules\Reference\Database\factories\WarehouseFactory;
use App\Modules\Reference\Enums\NegativeStockPolicy;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 */
class Warehouse extends Model implements Attachable
{
    use BelongsToCompany;

    /** @use HasFactory<WarehouseFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'warehouses';

    /** @var list<string> */
    protected $fillable = ['code', 'name', 'branch_id', 'address', 'is_active', 'negative_stock_policy', 'is_default'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): WarehouseFactory
    {
        return WarehouseFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'address' => 'array',
            'is_active' => 'boolean',
            'is_default' => 'boolean',
            'negative_stock_policy' => NegativeStockPolicy::class,
        ];
    }
}
