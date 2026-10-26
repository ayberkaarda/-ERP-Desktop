<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Models;

use App\Core\Company\BelongsToCompany;
use App\Modules\Assistant\Enums\MessageStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $conversation_id
 * @property string $company_id
 * @property string $user_id
 * @property string $request_id
 * @property string $role
 * @property MessageStatus $status
 * @property string $content
 * @property string|null $usage_id
 * @property int $reserved_tokens
 * @property bool $reservation_settled
 * @property list<array<string,mixed>> $context
 * @property array<int,array<string,mixed>> $sdk_messages
 * @property Carbon $created_at
 */
final class Message extends Model
{
    use BelongsToCompany;
    use HasUuids;

    protected $table = 'assistant_messages';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['status' => MessageStatus::class, 'context' => 'array', 'sdk_messages' => 'encrypted:array', 'reserved_tokens' => 'integer', 'reservation_settled' => 'boolean'];
    }
}
