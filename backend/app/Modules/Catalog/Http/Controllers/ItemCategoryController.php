<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\ItemCategoryRequest;
use App\Modules\Catalog\Http\Resources\ItemCategoryResource;
use App\Modules\Catalog\Models\ItemCategory;
use App\Modules\Catalog\Services\CategoryTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Filters: is_active, parent_id (uuid or "root"), subtree (uuid: the category and its descendants).
 * sort=path lists the tree depth-first.
 */
final class ItemCategoryController extends CatalogController
{
    public function __construct(private readonly CategoryTree $tree) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ItemCategory::class);
        [$request, $custom] = $this->customFilters($request, ['parent_id', 'subtree']);
        $query = ItemCategory::query();

        if (($custom['parent_id'] ?? null) === 'root') {
            $query->whereNull('parent_id');
        } else {
            $this->uuidFilter($query, 'parent_id', $custom, 'parent_id');
        }

        if (isset($custom['subtree'])) {
            $query->whereIn('id', CategoryTree::subtree($this->uuid('filter.subtree', $custom['subtree'])));
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['code', 'name', 'depth', 'path', 'created_at'], ['is_active', 'depth'], ['code', 'name']),
            ItemCategoryResource::class,
        );
    }

    public function store(ItemCategoryRequest $request): JsonResponse
    {
        Gate::authorize('create', ItemCategory::class);
        $category = $this->tree->create($request->validated());

        return ApiResponse::created($this->resolve(new ItemCategoryResource($category), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', ItemCategory::class);
        $category = ItemCategory::query()->findOrFail($id);
        Gate::authorize('view', $category);

        return ApiResponse::success($this->resolve(new ItemCategoryResource($category), $request));
    }

    public function update(ItemCategoryRequest $request, string $id): JsonResponse
    {
        Gate::authorize('updateAny', ItemCategory::class);
        $category = ItemCategory::query()->findOrFail($id);
        Gate::authorize('update', $category);
        $category = $this->tree->update($category, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new ItemCategoryResource($category), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('deleteAny', ItemCategory::class);
        $category = ItemCategory::query()->findOrFail($id);
        Gate::authorize('delete', $category);
        $this->tree->delete($category, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }
}
