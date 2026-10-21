<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Catalog\Http\Requests\UnitConversionRequest;
use App\Modules\Catalog\Http\Resources\UnitConversionResource;
use App\Modules\Catalog\Models\Unit;
use App\Modules\Catalog\Models\UnitConversion;
use App\Modules\Catalog\Services\PriceLineRules;
use App\Modules\Catalog\Services\UnitConverter;
use App\Modules\Catalog\Services\UnitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

final class UnitConversionController extends CatalogController
{
    public function __construct(private readonly UnitService $units) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Unit::class);
        [$request, $custom] = $this->customFilters($request, ['unit_id', 'from_unit_id', 'to_unit_id']);
        $query = UnitConversion::query()->with(['fromUnit', 'toUnit']);
        $this->uuidFilter($query, 'from_unit_id', $custom, 'from_unit_id');
        $this->uuidFilter($query, 'to_unit_id', $custom, 'to_unit_id');

        // Any edge touching the unit.
        if (isset($custom['unit_id'])) {
            $unit = $this->uuid('unit_id', $custom['unit_id']);
            $query->where(fn ($q) => $q->where('from_unit_id', $unit)->orWhere('to_unit_id', $unit));
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['created_at'], [], []),
            UnitConversionResource::class,
        );
    }

    public function store(UnitConversionRequest $request): JsonResponse
    {
        Gate::authorize('create', Unit::class);
        /** @var array{from_unit_id: string, to_unit_id: string, factor: string} $data */
        $data = $request->validated();
        $conversion = $this->units->createConversion($data['from_unit_id'], $data['to_unit_id'], $data['factor']);

        return ApiResponse::created($this->resolve(new UnitConversionResource($conversion->load(['fromUnit', 'toUnit'])), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $conversion = UnitConversion::query()->with(['fromUnit', 'toUnit'])->findOrFail($id);
        Gate::authorize('view', $conversion);

        return ApiResponse::success($this->resolve(new UnitConversionResource($conversion), $request));
    }

    public function update(UnitConversionRequest $request, string $id): JsonResponse
    {
        $conversion = UnitConversion::query()->findOrFail($id);
        Gate::authorize('update', $conversion);
        $this->units->updateConversion($conversion, (string) $request->string('factor'), $request->integer('version'));

        return ApiResponse::success($this->resolve(new UnitConversionResource($conversion->load(['fromUnit', 'toUnit'])), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $conversion = UnitConversion::query()->findOrFail($id);
        Gate::authorize('delete', $conversion);
        $this->assertDeleteVersion($request, $conversion);
        $this->units->deleteConversion($conversion);

        return ApiResponse::noContent();
    }

    /**
     * GET /units/convert?qty=&from_unit_id=&to_unit_id=&item_id=
     */
    public function convert(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Unit::class);

        /** @var array{qty: string, from_unit_id: string, to_unit_id: string, item_id?: string|null} $input */
        $input = Validator::make($request->query(), [
            'qty' => ['required', 'string', 'regex:'.PriceLineRules::DECIMAL],
            'from_unit_id' => ['required', 'uuid'],
            'to_unit_id' => ['required', 'uuid'],
            'item_id' => ['sometimes', 'nullable', 'uuid'],
        ])->validate();

        $result = (new UnitConverter)->convert($input['qty'], $input['from_unit_id'], $input['to_unit_id'], $input['item_id'] ?? null);

        return ApiResponse::success([...$input, 'item_id' => $input['item_id'] ?? null, 'result' => (string) $result]);
    }
}
