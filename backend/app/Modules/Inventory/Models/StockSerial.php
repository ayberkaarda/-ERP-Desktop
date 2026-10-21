<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use App\Modules\Inventory\Enums\SerialStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Serial unit; its history is its movements, so no activity log.
 *
 * @property string $id
 * @property string $company_id
 * @property string $item_id
 * @property string $serial_no
 * @property string|null $lot_id
 * @property SerialStatus $status
 * @property string|null $warehouse_id
 * @property string|null $location_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class StockSerial extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    /** @var list<string> */
    protected $fillable = ['item_id', 'serial_no', 'lot_id', 'status', 'warehouse_id', 'location_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['status' => SerialStatus::class];
    }
}
