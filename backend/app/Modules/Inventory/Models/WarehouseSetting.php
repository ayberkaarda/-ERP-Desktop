<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Modules\Inventory\Enums\ReservationPolicy;
use Illuminate\Database\Eloquent\Model;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * Inventory policy of one Reference warehouse (keyed by the warehouse id).
 *
 * @property string $warehouse_id
 * @property string $company_id
 * @property ReservationPolicy $reservation_policy
 * @property int $version
 */
class WarehouseSetting extends Model
{
    use BelongsToCompany;
    use HasVersion;
    use LogsActivity;

    protected $table = 'stock_warehouse_settings';

    protected $primaryKey = 'warehouse_id';

    protected $keyType = 'string';

    public $incrementing = false;

    /** @var list<string> */
    protected $fillable = ['reservation_policy'];

    public function getMorphClass(): string
    {
        return 'stock_warehouse_setting';
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['reservation_policy'])->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['reservation_policy' => ReservationPolicy::class];
    }
}
