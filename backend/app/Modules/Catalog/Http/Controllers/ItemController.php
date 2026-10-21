<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\ItemRequest;
use App\Modules\Catalog\Http\Resources\ItemResource;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Services\CategoryTree;
use App\Modules\Catalog\Services\ItemService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Filters: type, tracking, is_active, has_expiry, base_unit_id, category (uuid, whole subtree).
 * q matches code, name, barcodes and variant SKUs (pg_trgm indexes on each).
 */
final class ItemController extends CatalogController
{
    public function __construct(private readonly ItemService $items) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Item::class);
        [$request, $custom, $term] = $this->customFilters($request, ['category', 'base_unit_id'], takeSearch: true);
        $query = Item::query()->with('baseUnit');
        $this->uuidFilter($query, 'base_unit_id', $custom, 'base_unit_id');

        if (isset($custom['category'])) {
            $query->whereIn('category_id', CategoryTree::subtree($this->uuid('filter.category', $custom['category'])));
        }

        if ($term !== '') {
            $like = $this->like($term);
            $query->where(fn (Builder $q) => $q
                ->where('items.code', 'ilike', $like)
                ->orWhere('items.name', 'ilike', $like)
                ->orWhereIn('items.id', ItemBarcode::query()->select('item_id')->where('barcode', 'ilike', $like))
                ->orWhereIn('items.id', ItemVariant::query()->select('item_id')->where('sku', 'ilike', $like)));
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['code', 'name', 'type', 'created_at', 'updated_at'], ['type', 'tracking', 'is_active', 'has_expiry'], []),
            ItemResource::class,
        );
    }

    public function store(ItemRequest $request): JsonResponse
    {
        Gate::authorize('create', Item::class);
        $item = $this->items->create($request->validated());

        return ApiResponse::created($this->resolve(new ItemResource($item->load(['baseUnit', 'category', 'units.unit'])), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', Item::class);
        $item = Item::query()->with(['baseUnit', 'category', 'units.unit'])->findOrFail($id);
        Gate::authorize('view', $item);

        return ApiResponse::success($this->resolve(new ItemResource($item), $request));
    }

    public function update(ItemRequest $request, string $id): JsonResponse
    {
        Gate::authorize('updateAny', Item::class);
        $item = Item::query()->findOrFail($id);
        Gate::authorize('update', $item);
        $item = $this->items->update($item, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new ItemResource($item->load(['baseUnit', 'category', 'units.unit'])), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('deleteAny', Item::class);
        $item = Item::query()->findOrFail($id);
        Gate::authorize('delete', $item);
        $this->items->delete($item, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }
}
