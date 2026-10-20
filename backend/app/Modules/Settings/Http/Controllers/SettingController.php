<?php

declare(strict_types=1);

namespace App\Modules\Settings\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Settings\Http\Requests\UpdateSettingsRequest;
use App\Modules\Settings\Http\Resources\SettingResource;
use App\Modules\Settings\Models\Setting;
use App\Modules\Settings\Services\SettingsService;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Gate;

final class SettingController extends Controller
{
    public function __construct(private readonly SettingsService $settings) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Setting::class);

        $group = $request->query('group');

        return ApiResponse::success($this->resources($this->actor($request), is_string($group) ? $group : null));
    }

    public function update(UpdateSettingsRequest $request): JsonResponse
    {
        Gate::authorize('update', Setting::class);

        $actor = $this->actor($request);
        $this->settings->update($request->changes(), $actor);

        // Writing is not reading: values come back only to users who may view them.
        if (! Gate::forUser($actor)->allows('viewAny', Setting::class)) {
            return ApiResponse::noContent();
        }

        return ApiResponse::success($this->resources($actor, null));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function resources(Authenticatable $actor, ?string $group): array
    {
        return array_map(
            static fn (array $row): array => (new SettingResource($row))->resolve(),
            $this->settings->visibleTo($actor, $group),
        );
    }

    private function actor(Request $request): Authenticatable
    {
        $user = $request->user();

        return $user instanceof Authenticatable ? $user : abort(401);
    }
}
