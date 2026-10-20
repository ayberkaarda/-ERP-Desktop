<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasStatus;
use App\Core\Documents\HasVersion;
use App\Core\Documents\InteractsWithStatus;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @phpstan-type Snapshot array{position: int, mode: string, approvers: list<string>}
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $flow_id
 * @property string $document_type
 * @property string $document_id
 * @property string $status
 * @property int|null $current_step
 * @property string|null $amount
 * @property string $requested_by
 * @property bool $allow_self_approval
 * @property list<array{position: int, mode: string, approvers: list<string>}> $steps
 * @property int $version
 * @property Collection<int, ApprovalDecision> $decisions
 */
final class ApprovalRequest extends Model implements HasStatus
{
    use BelongsToCompany, HasUuid7, HasVersion, InteractsWithStatus;

    protected $guarded = ['id', 'company_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'steps' => 'array', 'current_step' => 'integer',
            'amount' => 'decimal:4', 'allow_self_approval' => 'boolean',
        ];
    }

    /** @return HasMany<ApprovalDecision, $this> */
    public function decisions(): HasMany
    {
        return $this->hasMany(ApprovalDecision::class, 'request_id')->orderBy('decided_at')->orderBy('id');
    }

    /** @return array{position: int, mode: string, approvers: list<string>}|null */
    public function activeStep(): ?array
    {
        foreach ($this->steps as $step) {
            if ($step['position'] === $this->current_step) {
                return $step;
            }
        }

        return null;
    }
}
