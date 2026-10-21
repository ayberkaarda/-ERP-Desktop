<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Parties\Http\Requests\VersionRequest;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Models\PartyChild;
use App\Modules\Parties\Services\PartyChildService;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;

/**
 * Sub-resources of /parties/{party}: the party is resolved in the active company first and the
 * child only through that party, so ids of other parties or companies are 404.
 *
 * @template TChild of PartyChild
 */
abstract class PartyChildController
{
    public function __construct(protected readonly PartyChildService $children) {}

    /** @return class-string<TChild> */
    abstract protected function model(): string;

    /** @return class-string<JsonResource> */
    abstract protected function resource(): string;

    /** @return HasMany<TChild, Party> */
    abstract protected function relation(Party $party): HasMany;

    public function index(Request $request, string $party): JsonResponse
    {
        $model = $this->party($party, 'view');
        $rows = $this->relation($model)->orderByDesc($this->model()::defaultFlag())->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::success($this->resource()::collection($rows)->resolve($request));
    }

    public function show(Request $request, string $party, string $child): JsonResponse
    {
        $row = $this->child($this->party($party, 'view'), $child);

        return ApiResponse::success($this->present($row, $request));
    }

    public function destroy(VersionRequest $request, string $party, string $child): JsonResponse
    {
        $model = $this->party($party, 'update');
        $this->children->delete($model, $this->child($model, $child), $request->integer('version'));

        return ApiResponse::noContent();
    }

    protected function storeFrom(FormRequest $request, string $party): JsonResponse
    {
        $model = $this->party($party, 'update');
        $row = $this->children->create($model, $this->model(), $this->defaults($model, $request->validated()));

        return ApiResponse::created($this->present($row, $request));
    }

    protected function updateFrom(FormRequest $request, string $party, string $child): JsonResponse
    {
        $model = $this->party($party, 'update');
        $row = $this->children->update($model, $this->child($model, $child), $request->validated());

        return ApiResponse::success($this->present($row, $request));
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    protected function defaults(Party $party, array $data): array
    {
        return $data;
    }

    private function party(string $id, string $ability): Party
    {
        $party = Party::query()->findOrFail($id);
        Gate::authorize($ability, $party);

        return $party;
    }

    /** Only children of this party. */
    private function child(Party $party, string $id): PartyChild
    {
        return $this->relation($party)->findOrFail($id);
    }

    /** @return array<string, mixed> */
    private function present(PartyChild $row, Request $request): array
    {
        $resource = $this->resource();

        return (new $resource($row))->resolve($request);
    }
}
