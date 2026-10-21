<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\PriceListRequest;
use App\Modules\Catalog\Http\Resources\PriceListResource;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Services\PriceListService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class PriceListController extends CatalogController
{
    public function __construct(private readonly PriceListService $lists) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', PriceList::class);

        return ApiResponse::paginated(
            ListQuery::for(PriceList::query(), $request, ['code', 'name', 'currency_code', 'valid_from', 'created_at'], ['currency_code', 'is_active', 'is_default', 'tax_inclusive'], ['code', 'name']),
            PriceListResource::class,
        );
    }

    public function store(PriceListRequest $request): JsonResponse
    {
        Gate::authorize('create', PriceList::class);
        $list = $this->lists->create($request->validated());

        return ApiResponse::created($this->resolve(new PriceListResource($list), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', PriceList::class);
        $list = PriceList::query()->findOrFail($id);
        Gate::authorize('view', $list);

        return ApiResponse::success($this->resolve(new PriceListResource($list), $request));
    }

    public function update(PriceListRequest $request, string $id): JsonResponse
    {
        Gate::authorize('updateAny', PriceList::class);
        $list = PriceList::query()->findOrFail($id);
        Gate::authorize('update', $list);
        $list = $this->lists->update($list, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new PriceListResource($list), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('deleteAny', PriceList::class);
        $list = PriceList::query()->findOrFail($id);
        Gate::authorize('delete', $list);
        $this->lists->delete($list, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }
}
