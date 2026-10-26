<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $device_id
 * @property string $token_hash
 * @property string $family_id
 * @property int $auth_version
 * @property Carbon $expires_at
 * @property Carbon|null $used_at
 */
class DeviceRefreshToken extends Model
{
    use HasUuid7;

    protected $guarded = [];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'used_at' => 'datetime'];
    }
}
