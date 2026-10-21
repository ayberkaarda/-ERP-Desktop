<?php

declare(strict_types=1);

namespace App\Modules\Organization\Services;

use App\Modules\Organization\Contracts\BranchLookup;
use App\Modules\Organization\Models\Branch;
use Illuminate\Support\Str;

/**
 * Company scoped through BelongsToCompany: ids of other companies are not found.
 */
final class DatabaseBranchLookup implements BranchLookup
{
    public function exists(string $id): bool
    {
        return Str::isUuid($id) && Branch::query()->whereKey($id)->where('is_active', true)->exists();
    }
}
