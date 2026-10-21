<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\ItemUnitRequest;
use App\Modules\Catalog\Http\Resources\ItemUnitResource;
use App\Modules\Catalog\Models\Item;
use App\Modules\Catalog\Models\ItemUnit;
use App\Modules\Catalog\Services\ItemPartsService;
use App\Modules\Catalog\Services\UnitConverter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * /items/{item}/units: alternate units, 1 unit = factor base units.
 */
final class ItemUnitController extends CatalogController
{
    public function __construct(private readonly ItemPartsService $parts) {}

    public function index(Request $request, string $item): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('view', $model);

        return ApiResponse::paginated(
            ListQuery::for(ItemUnit::query()->with('unit')->where('item_id', $model->id), $request, ['created_at'], [], []),
            ItemUnitResource::class,
        );
    }

    public function store(ItemUnitRequest $request, string $item): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        /** @var array{unit_id: string, factor: string} $data */
        $data = $request->validated();
        $unit = $this->parts->createUnit($model, $data, new UnitConverter);

        return ApiResponse::created($this->resolve(new ItemUnitResource($unit->load('unit')), $request));
    }

    public function show(Request $request, string $item, string $id): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('view', $model);
        $unit = ItemUnit::query()->with('unit')->where('item_id', $model->id)->findOrFail($id);

        return ApiResponse::success($this->resolve(new ItemUnitResource($unit), $request));
    }

    public function update(ItemUnitRequest $request, string $item, string $id): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $unit = ItemUnit::query()->where('item_id', $model->id)->findOrFail($id);
        $this->parts->updateUnit($model, $unit, (string) $request->string('factor'), $request->integer('version'), new UnitConverter);

        return ApiResponse::success($this->resolve(new ItemUnitResource($unit->load('unit')), $request));
    }

    public function destroy(Request $request, string $item, string $id): JsonResponse
    {
        $model = Item::query()->findOrFail($item);
        Gate::authorize('update', $model);
        $unit = ItemUnit::query()->where('item_id', $model->id)->findOrFail($id);
        $this->assertDeleteVersion($request, $unit);
        $this->parts->deleteUnit($model, $unit);

        return ApiResponse::noContent();
    }
}
