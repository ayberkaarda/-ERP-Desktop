<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Inventory\Http\Requests\WarehouseSettingRequest;
use App\Modules\Inventory\Http\Resources\WarehouseResource;
use App\Modules\Inventory\Models\WarehouseSetting;
use App\Modules\Inventory\Services\WarehouseDirectory;
use App\Modules\Inventory\Support\Stock;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Warehouses as the stock ledger sees them. The warehouse master and its locations are maintained
 * through Reference (/warehouses, /warehouses/{id}/locations); here only the inventory policy.
 */
final class WarehouseController extends InventoryController
{
    public function __construct(private readonly WarehouseDirectory $warehouses) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', WarehouseSetting::class);

        return ApiResponse::success(WarehouseResource::collection($this->warehouses->all())->resolve($request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', WarehouseSetting::class);
        $warehouse = $this->warehouses->find($id) ?? throw (new ModelNotFoundException)->setModel(WarehouseSetting::class, [$id]);

        return ApiResponse::success([
            ...$this->resolve(new WarehouseResource($warehouse), $request),
            'has_movements' => $this->warehouses->hasMovements($warehouse->id),
        ]);
    }

    public function update(WarehouseSettingRequest $request, string $id): JsonResponse
    {
        $warehouse = $this->warehouses->find($id) ?? throw (new ModelNotFoundException)->setModel(WarehouseSetting::class, [$id]);

        Stock::transaction(function () use ($warehouse, $request): void {
            Stock::lock($warehouse->companyId, 'warehouse.'.$warehouse->id);
            $setting = WarehouseSetting::query()->whereKey($warehouse->id)->lockForUpdate()->first();

            if ($setting === null) {
                // The row is created on the first change; until then the warehouse reports version 1.
                $setting = new WarehouseSetting;
                $setting->warehouse_id = $warehouse->id;
                $setting->save();
            }

            $setting->assertVersion($request->integer('version'));
            $setting->fill(['reservation_policy' => $request->string('reservation_policy')->toString()]);
            $setting->save();
        });

        $fresh = $this->warehouses->find($warehouse->id) ?? $warehouse;

        return ApiResponse::success($this->resolve(new WarehouseResource($fresh), $request));
    }
}
