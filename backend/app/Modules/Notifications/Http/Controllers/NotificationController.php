<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Notifications\Http\Resources\NotificationResource;
use App\Modules\Notifications\Models\Notification;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Gate;

final class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Notification::class);

        $query = $this->mine($request);

        if ($request->boolean('unread')) {
            $query->whereNull('read_at');
        }
        if (! $request->filled('sort')) {
            $query->orderByDesc('created_at')->orderByDesc('id');
        }

        $page = ListQuery::for($query, $request, ['created_at', 'read_at'], ['type'], []);
        $items = NotificationResource::collection($page->items())->resolve($request);

        return ApiResponse::success($items, [
            'pagination' => [
                'current_page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'last_page' => $page->lastPage(),
            ],
            'unread_count' => $this->mine($request)->whereNull('read_at')->count(),
        ]);
    }

    public function read(Request $request, string $id): JsonResponse
    {
        // Looked up inside the caller's own rows: someone else's id is simply not found.
        $notification = $this->mine($request)->findOrFail($id);
        Gate::authorize('update', $notification);

        if ($notification->read_at === null) {
            $notification->forceFill(['read_at' => now()])->save();
        }

        return ApiResponse::success((new NotificationResource($notification))->resolve());
    }

    public function readAll(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Notification::class);

        $updated = $this->mine($request)->whereNull('read_at')->update(['read_at' => now()]);

        return ApiResponse::success(['updated' => $updated]);
    }

    /**
     * @return Builder<Notification>
     */
    private function mine(Request $request): Builder
    {
        $user = $request->user();
        $id = $user instanceof Authenticatable ? $user->getAuthIdentifier() : null;

        return Notification::query()->where('user_id', is_string($id) ? $id : '');
    }
}
