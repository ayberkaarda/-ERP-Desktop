<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Inventory\Models\StockMovement;
use App\Modules\Inventory\Services\ReorderAdvisor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Items at or below their reorder point (available over all warehouses); q on item code/name.
 */
final class ReorderController extends InventoryController
{
    public function index(Request $request, ReorderAdvisor $advisor): JsonResponse
    {
        Gate::authorize('viewAny', StockMovement::class);
        $q = $request->query('q');

        return ApiResponse::success($advisor->suggestions($this->companyId(), is_string($q) ? mb_substr(trim($q), 0, 200) : null));
    }
}
