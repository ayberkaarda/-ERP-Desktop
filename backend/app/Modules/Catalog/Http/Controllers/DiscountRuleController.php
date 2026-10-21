<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\DiscountRuleRequest;
use App\Modules\Catalog\Http\Resources\DiscountRuleResource;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Services\DiscountRuleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class DiscountRuleController extends CatalogController
{
    public function __construct(private readonly DiscountRuleService $rules) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', DiscountRule::class);
        [$request, $custom] = $this->customFilters($request, ['party_id', 'scope_ref']);
        $query = DiscountRule::query();
        $this->uuidFilter($query, 'party_id', $custom, 'party_id');
        $this->uuidFilter($query, 'scope_ref', $custom, 'scope_ref');

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['code', 'name', 'priority', 'valid_from', 'created_at'], ['scope', 'is_active', 'stackable'], ['code', 'name']),
            DiscountRuleResource::class,
        );
    }

    public function store(DiscountRuleRequest $request): JsonResponse
    {
        Gate::authorize('create', DiscountRule::class);
        $rule = $this->rules->create($request->validated());

        return ApiResponse::created($this->resolve(new DiscountRuleResource($rule), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', DiscountRule::class);
        $rule = DiscountRule::query()->findOrFail($id);
        Gate::authorize('view', $rule);

        return ApiResponse::success($this->resolve(new DiscountRuleResource($rule), $request));
    }

    public function update(DiscountRuleRequest $request, string $id): JsonResponse
    {
        Gate::authorize('updateAny', DiscountRule::class);
        $rule = DiscountRule::query()->findOrFail($id);
        Gate::authorize('update', $rule);

        $rule = $this->rules->update($rule, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new DiscountRuleResource($rule), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('deleteAny', DiscountRule::class);
        $rule = DiscountRule::query()->findOrFail($id);
        Gate::authorize('delete', $rule);
        $this->rules->delete($rule, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }
}
