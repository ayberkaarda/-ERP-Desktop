<?php

declare(strict_types=1);

namespace App\Modules\Sync\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Modules\Sync\Http\Middleware\EnsureDesktopToken;
use App\Modules\Sync\Http\Requests\PullRequest;
use App\Modules\Sync\Http\Requests\PushRequest;
use App\Modules\Sync\Services\ManifestPresenter;
use App\Modules\Sync\Services\PullService;
use App\Modules\Sync\Services\PushService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Desktop sync endpoints (docs/SYNC-PROTOCOL.md). Bodies follow contracts/sync/*.schema.json.
 */
final class SyncController extends Controller
{
    /**
     * Sync scope of the active company for the user: resources, permissions, limits.
     */
    public function manifest(Request $request, ManifestPresenter $presenter): JsonResponse
    {
        return $this->respond($presenter->present($this->user($request), self::company(), self::tokenId($request)));
    }

    /**
     * Incremental read per resource cursor.
     */
    public function pull(PullRequest $request, PullService $pull): JsonResponse
    {
        return $this->respond($pull->pull($this->user($request), self::company(), $request->resources(), self::tokenId($request)));
    }

    /**
     * Outbox mutations, one result per mutation in request order.
     */
    public function push(PushRequest $request, PushService $push): JsonResponse
    {
        return $this->respond(['results' => $push->push($this->user($request), self::company(), $request->mutations())]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function respond(array $data): JsonResponse
    {
        return new JsonResponse(['data' => $data, 'meta' => new \stdClass], 200, [], JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    }

    private static function tokenId(Request $request): ?string
    {
        $id = $request->attributes->get(EnsureDesktopToken::TOKEN_ATTRIBUTE);

        return is_string($id) ? $id : null;
    }

    private static function company(): string
    {
        return app(CompanyContext::class)->id();
    }

    private function user(Request $request): User
    {
        $user = $request->user();
        assert($user instanceof User);

        return $user;
    }
}
