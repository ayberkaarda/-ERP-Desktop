<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $company_id
 * @property string $request_id
 * @property int $step_position
 * @property string $actor_id
 * @property string $decision
 * @property string|null $comment
 * @property CarbonImmutable $decided_at
 */
final class ApprovalDecision extends Model
{
    use BelongsToCompany, HasUuid7;

    protected $guarded = ['id', 'company_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['step_position' => 'integer', 'decided_at' => 'immutable_datetime'];
    }
}
