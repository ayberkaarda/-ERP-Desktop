<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Models;

use App\Core\Company\BelongsToCompany;
use App\Modules\Assistant\Enums\ToolStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $message_id
 * @property string $conversation_id
 * @property string $company_id
 * @property string $user_id
 * @property string $provider_call_id
 * @property string $tool
 * @property string $kind
 * @property ToolStatus $status
 * @property string|null $reason
 * @property array<string,mixed> $arguments
 * @property array<string,mixed> $preview
 * @property mixed $result
 */
final class ToolCall extends Model
{
    use BelongsToCompany;
    use HasUuids;

    protected $table = 'assistant_tool_calls';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['status' => ToolStatus::class, 'arguments' => 'encrypted:array', 'preview' => 'array', 'result' => 'json'];
    }
}
