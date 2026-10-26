<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Identity\Contracts\PermissionRegistry;
use App\Modules\Identity\Models\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * GET /permissions: the catalog grouped by module, for role editing.
 */
final class PermissionController
{
    public function index(PermissionRegistry $catalog): JsonResponse
    {
        Gate::authorize('viewAny', Role::class);

        $groups = [];

        foreach ($catalog->grouped() as $module => $names) {
            sort($names);
            $groups[] = ['module' => $module, 'permissions' => $names];
        }

        return ApiResponse::success($groups);
    }
}
