<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Support\HasUuid7;
use App\Models\User;
use App\Modules\Identity\Enums\SessionEvent;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string|null $user_id
 * @property string|null $email
 * @property SessionEvent $event
 * @property string|null $ip_address
 * @property string|null $user_agent
 * @property Carbon $created_at
 * @property-read User|null $user
 */
class SessionLog extends Model
{
    use HasUuid7;

    public const UPDATED_AT = null;

    protected $guarded = [];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    protected function casts(): array
    {
        return ['event' => SessionEvent::class, 'created_at' => 'datetime'];
    }
}
