<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Models;

use App\Core\Company\BelongsToCompany;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $company_id
 * @property string $user_id
 * @property string $title
 * @property int $version
 * @property string|null $lease_token
 * @property Carbon|null $busy_until
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
final class Conversation extends Model
{
    use BelongsToCompany;
    use HasUuids;

    protected $table = 'assistant_conversations';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['version' => 'integer', 'busy_until' => 'immutable_datetime'];
    }
}
