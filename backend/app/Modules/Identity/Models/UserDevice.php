<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $user_id
 * @property string|null $token_id
 * @property string $name
 * @property string $fingerprint_hash
 * @property string|null $ip_address
 * @property string|null $user_agent
 * @property Carbon|null $last_used_at
 * @property Carbon $expires_at
 * @property Carbon|null $created_at
 */
class UserDevice extends Model
{
    use HasUuid7;

    protected $guarded = [];

    protected $hidden = ['fingerprint_hash', 'token_id'];

    protected function casts(): array
    {
        return ['last_used_at' => 'datetime', 'expires_at' => 'datetime'];
    }
}
