<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\UnitRequest;
use App\Modules\Catalog\Http\Resources\UnitResource;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Services\CatalogRules;
use App\Modules\Catalog\Services\UnitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class UnitController extends CatalogController
{
    public function __construct(private readonly UnitService $units) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Unit::class);

        return ApiResponse::paginated(
            ListQuery::for(Unit::query(), $request, ['code', 'name', 'created_at'], ['is_active'], ['code', 'name', 'symbol']),
            UnitResource::class,
        );
    }

    public function store(UnitRequest $request): JsonResponse
    {
        Gate::authorize('create', Unit::class);
        $unit = CatalogRules::transaction(fn (): Unit => Unit::query()->create($request->validated()), UnitService::INDEXES);

        return ApiResponse::created($this->resolve(new UnitResource($unit), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $unit = Unit::query()->findOrFail($id);
        Gate::authorize('view', $unit);

        return ApiResponse::success($this->resolve(new UnitResource($unit), $request));
    }

    public function update(UnitRequest $request, string $id): JsonResponse
    {
        $unit = Unit::query()->findOrFail($id);
        Gate::authorize('update', $unit);

        CatalogRules::transaction(function () use ($unit, $request): void {
            $unit->assertVersion($request->integer('version'));
            $unit->fill(collect($request->validated())->except('version')->all())->save();
        }, UnitService::INDEXES);

        return ApiResponse::success($this->resolve(new UnitResource($unit), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $unit = Unit::query()->findOrFail($id);
        Gate::authorize('delete', $unit);
        $this->assertDeleteVersion($request, $unit);
        $this->units->delete($unit);

        return ApiResponse::noContent();
    }
}
