<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $company_id
 * @property string $flow_id
 * @property int $position
 * @property string $mode
 * @property string $approver_type
 * @property string $approver_ref
 * @property string|null $min_amount
 * @property string|null $max_amount
 */
final class ApprovalFlowStep extends Model
{
    use BelongsToCompany, HasUuid7;

    protected $guarded = ['id', 'company_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['position' => 'integer', 'min_amount' => 'decimal:4', 'max_amount' => 'decimal:4'];
    }
}
