<?php

declare(strict_types=1);

namespace App\Modules\Reference\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Reference\Http\Requests\ReferenceRequest;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Repositories\ReferenceRepository;
use App\Modules\Reference\Services\ReferenceSchema;
use App\Modules\Reference\Services\ReferenceWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class ReferenceController
{
    public function __construct(
        private readonly ReferenceWriter $writer,
        private readonly ReferenceRepository $repository,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $class = $this->model($request);
        Gate::authorize('viewAny', [$class, $class]);
        $model = new $class;
        $fields = $model->getFillable();
        $search = array_values(array_intersect(['code', 'name', 'currency_code', 'barcode'], $fields));
        $filters = array_values(array_intersect(['is_active', 'type', 'status', 'source', 'currency_code', 'rate_date', 'parent_id', 'cost_center_id'], $fields));

        return ApiResponse::paginated(ListQuery::for($this->query($request), $request, [...$search, 'created_at', ...array_values(array_intersect(['rate_date', 'effective_from'], $fields))], $filters, $search), ReferenceResource::class);
    }

    public function show(Request $request): JsonResponse
    {
        $record = $this->query($request)->whereKey($this->id($request))->firstOrFail();
        Gate::authorize('view', $record);
        $data = (new ReferenceResource($record))->resolve($request);

        return ApiResponse::success($data);
    }

    public function store(ReferenceRequest $request): JsonResponse
    {
        $class = $this->model($request);
        Gate::authorize('create', [$class, $class]);
        abort_if($class === Currency::class, 403);
        $record = $this->writer->save(new $class, $request->toDto(), $this->warehouse($request));

        return ApiResponse::created((new ReferenceResource($record))->resolve($request));
    }

    public function update(ReferenceRequest $request): JsonResponse
    {
        $record = $this->query($request)->whereKey($this->id($request))->firstOrFail();
        Gate::authorize('update', $record);
        $saved = $this->writer->save($record, $request->toDto(), $this->warehouse($request));

        return ApiResponse::success((new ReferenceResource($saved))->resolve($request));
    }

    public function destroy(ReferenceRequest $request): JsonResponse
    {
        $record = $this->query($request)->whereKey($this->id($request))->firstOrFail();
        Gate::authorize('delete', $record);
        $this->writer->delete($record, $request->integer('version'));

        return ApiResponse::noContent();
    }

    /** @return class-string<Model> */
    private function model(Request $request): string
    {
        return ReferenceSchema::model($this->resource($request));
    }

    /** @return Builder<Model> */
    private function query(Request $request): Builder
    {
        return $this->repository->query($this->resource($request), $this->warehouse($request));
    }

    private function resource(Request $request): string
    {
        $resource = $request->route('resource');
        abort_unless(is_string($resource) && array_key_exists($resource, ReferenceSchema::MODELS), 404);

        return $resource;
    }

    private function warehouse(Request $request): ?string
    {
        $value = $request->route('warehouse');

        return is_string($value) ? $value : null;
    }

    private function id(Request $request): string
    {
        $id = $request->route('id');
        abort_unless(is_string($id), 404);

        return $id;
    }
}
