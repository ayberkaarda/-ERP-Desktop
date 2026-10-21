<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\BulkPriceListLinesRequest;
use App\Modules\Catalog\Http\Requests\PriceListLineRequest;
use App\Modules\Catalog\Http\Resources\PriceListLineResource;
use App\Modules\Catalog\Models\PriceList;
use App\Modules\Catalog\Models\PriceListLine;
use App\Modules\Catalog\Services\PriceListService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * /price-lists/{priceList}/lines; filters item_id, variant_id, unit_id.
 */
final class PriceListLineController extends CatalogController
{
    public function __construct(private readonly PriceListService $lists) {}

    public function index(Request $request, string $priceList): JsonResponse
    {
        $list = PriceList::query()->findOrFail($priceList);
        Gate::authorize('view', $list);
        [$request, $custom] = $this->customFilters($request, ['item_id', 'variant_id', 'unit_id']);
        $query = PriceListLine::query()->where('price_list_id', $list->id);

        foreach (['item_id', 'variant_id', 'unit_id'] as $filter) {
            $this->uuidFilter($query, $filter, $custom, $filter);
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['min_qty', 'price', 'valid_from', 'created_at'], [], []),
            PriceListLineResource::class,
        );
    }

    public function store(PriceListLineRequest $request, string $priceList): JsonResponse
    {
        $list = PriceList::query()->findOrFail($priceList);
        Gate::authorize('update', $list);
        $line = $this->lists->createLine($list, $request->validated());

        return ApiResponse::created($this->resolve(new PriceListLineResource($line), $request));
    }

    public function show(Request $request, string $priceList, string $id): JsonResponse
    {
        $list = PriceList::query()->findOrFail($priceList);
        Gate::authorize('view', $list);
        $line = PriceListLine::query()->where('price_list_id', $list->id)->findOrFail($id);

        return ApiResponse::success($this->resolve(new PriceListLineResource($line), $request));
    }

    public function update(PriceListLineRequest $request, string $priceList, string $id): JsonResponse
    {
        $list = PriceList::query()->findOrFail($priceList);
        Gate::authorize('update', $list);
        $line = PriceListLine::query()->where('price_list_id', $list->id)->findOrFail($id);
        $this->lists->updateLine($list, $line, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new PriceListLineResource($line), $request));
    }

    public function destroy(Request $request, string $priceList, string $id): JsonResponse
    {
        $list = PriceList::query()->findOrFail($priceList);
        Gate::authorize('update', $list);
        $line = PriceListLine::query()->where('price_list_id', $list->id)->findOrFail($id);
        $this->assertDeleteVersion($request, $line);
        $this->lists->deleteLine($list, $line);

        return ApiResponse::noContent();
    }

    /**
     * PUT /price-lists/{priceList}/lines: transactional upsert by natural key, all or nothing.
     */
    public function bulk(BulkPriceListLinesRequest $request, string $priceList): JsonResponse
    {
        $list = PriceList::query()->findOrFail($priceList);
        Gate::authorize('update', $list);
        /** @var list<array<string, mixed>> $lines */
        $lines = $request->validated('lines');
        $result = $this->lists->upsertLines($list, $lines);

        return ApiResponse::success(
            PriceListLineResource::collection($result['lines'])->resolve($request),
            ['created' => $result['created'], 'updated' => $result['updated'], 'unchanged' => $result['unchanged']],
        );
    }
}
