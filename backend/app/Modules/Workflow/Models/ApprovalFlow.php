<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $company_id
 * @property string $document_type
 * @property string $name
 * @property bool $is_active
 * @property bool $allow_self_approval
 * @property int $version
 * @property Collection<int, ApprovalFlowStep> $steps
 */
final class ApprovalFlow extends Model
{
    use BelongsToCompany, HasUuid7, HasVersion, SoftDeletes;

    protected $guarded = ['id', 'company_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'allow_self_approval' => 'boolean'];
    }

    /** @return HasMany<ApprovalFlowStep, $this> */
    public function steps(): HasMany
    {
        return $this->hasMany(ApprovalFlowStep::class, 'flow_id')->orderBy('position');
    }
}
