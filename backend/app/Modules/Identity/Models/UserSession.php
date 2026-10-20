<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $user_id
 * @property string $session_hash
 * @property string $session_id_encrypted
 * @property string|null $ip_address
 * @property string|null $user_agent
 * @property Carbon $last_active_at
 */
class UserSession extends Model
{
    use HasUuid7;

    protected $guarded = [];

    protected $hidden = ['session_hash', 'session_id_encrypted'];

    protected function casts(): array
    {
        return ['last_active_at' => 'datetime'];
    }
}
