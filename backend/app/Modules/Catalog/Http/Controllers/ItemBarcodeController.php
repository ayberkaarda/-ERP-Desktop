<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\ItemBarcodeRequest;
use App\Modules\Catalog\Http\Resources\ItemBarcodeResource;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemBarcode;
use App\Modules\Catalog\Services\ItemPartsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class ItemBarcodeController extends CatalogController
{
    public function __construct(private readonly ItemPartsService $parts) {}

    public function index(Request $request, string $item): JsonResponse
    {
        Gate::authorize('viewAny', Item::class);
        $model = Item::query()->findOrFail($item);
        Gate::authorize('view', $model);

        return ApiResponse::paginated(
            ListQuery::for(ItemBarcode::query()->where('item_id', $model->id), $request, ['barcode', 'created_at'], ['type', 'is_primary'], ['barcode']),
            ItemBarcodeResource::class,
        );
    }

    public function store(ItemBarcodeRequest $request, string $item): JsonResponse
    {
        Gate::authorize('updateAny', Item::class);
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $data = $request->validated();
        $data['unit_id'] ??= $model->base_unit_id;
        $barcode = $this->parts->createBarcode($model, $data);

        return ApiResponse::created($this->resolve(new ItemBarcodeResource($barcode), $request));
    }

    public function show(Request $request, string $item, string $id): JsonResponse
    {
        Gate::authorize('viewAny', Item::class);
        $model = Item::query()->findOrFail($item);
        Gate::authorize('view', $model);
        $barcode = ItemBarcode::query()->where('item_id', $model->id)->findOrFail($id);

        return ApiResponse::success($this->resolve(new ItemBarcodeResource($barcode), $request));
    }

    public function update(ItemBarcodeRequest $request, string $item, string $id): JsonResponse
    {
        Gate::authorize('updateAny', Item::class);
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $barcode = ItemBarcode::query()->where('item_id', $model->id)->findOrFail($id);
        $data = collect($request->validated())->except('version')->all();

        if (array_key_exists('unit_id', $data) && $data['unit_id'] === null) {
            $data['unit_id'] = $model->base_unit_id;
        }

        $this->parts->updateBarcode($model, $barcode, $data, $request->integer('version'));

        return ApiResponse::success($this->resolve(new ItemBarcodeResource($barcode), $request));
    }

    public function destroy(Request $request, string $item, string $id): JsonResponse
    {
        Gate::authorize('updateAny', Item::class);
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $barcode = ItemBarcode::query()->where('item_id', $model->id)->findOrFail($id);
        $this->parts->deleteBarcode($model, $barcode, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }
}
