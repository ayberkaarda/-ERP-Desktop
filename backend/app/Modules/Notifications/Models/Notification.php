<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $company_id
 * @property string $user_id
 * @property string $type
 * @property array<string, mixed> $data
 * @property Carbon|null $read_at
 * @property Carbon $created_at
 */
class Notification extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    public const UPDATED_AT = null;

    protected $table = 'notifications';

    // Sub-second precision keeps newest-first ordering stable.
    protected $dateFormat = 'Y-m-d H:i:s.uP';

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['data' => 'array', 'read_at' => 'datetime', 'created_at' => 'datetime'];
    }
}
