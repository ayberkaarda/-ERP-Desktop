<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\ItemVariantRequest;
use App\Modules\Catalog\Http\Resources\ItemVariantResource;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemVariant;
use App\Modules\Catalog\Services\ItemPartsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class ItemVariantController extends CatalogController
{
    public function __construct(private readonly ItemPartsService $parts) {}

    public function index(Request $request, string $item): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('view', $model);

        return ApiResponse::paginated(
            ListQuery::for(ItemVariant::query()->where('item_id', $model->id), $request, ['sku', 'name', 'created_at'], ['is_active'], ['sku', 'name']),
            ItemVariantResource::class,
        );
    }

    public function store(ItemVariantRequest $request, string $item): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $variant = $this->parts->createVariant($model, $request->validated());

        return ApiResponse::created($this->resolve(new ItemVariantResource($variant), $request));
    }

    public function show(Request $request, string $item, string $id): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('view', $model);
        $variant = ItemVariant::query()->where('item_id', $model->id)->findOrFail($id);

        return ApiResponse::success($this->resolve(new ItemVariantResource($variant), $request));
    }

    public function update(ItemVariantRequest $request, string $item, string $id): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $variant = ItemVariant::query()->where('item_id', $model->id)->findOrFail($id);
        $this->parts->updateVariant($variant, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new ItemVariantResource($variant), $request));
    }

    public function destroy(Request $request, string $item, string $id): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $variant = ItemVariant::query()->where('item_id', $model->id)->findOrFail($id);
        $this->assertDeleteVersion($request, $variant);
        $this->parts->deleteVariant($model, $variant);

        return ApiResponse::noContent();
    }
}
