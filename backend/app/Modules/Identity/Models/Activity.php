<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Spatie\Activitylog\Models\Activity as SpatieActivity;

/**
 * Audit entry. Company scoped; account-level entries (no company) are written with company_id null
 * and are only readable through withoutCompanyScope().
 *
 * @property string $id
 * @property string|null $company_id
 */
class Activity extends SpatieActivity
{
    use BelongsToCompany;
    use HasUuid7;
}
