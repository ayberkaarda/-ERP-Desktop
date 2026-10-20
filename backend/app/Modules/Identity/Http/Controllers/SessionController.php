<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Identity\Enums\SessionEvent;
use App\Modules\Identity\Http\Resources\SessionResource;
use App\Modules\Identity\Models\UserSession;
use App\Modules\Identity\Services\AccessRevoker;
use App\Modules\Identity\Services\SessionAuthenticator;
use App\Modules\Identity\Services\SessionLogger;
use App\Modules\Identity\Services\SessionRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * The signed-in user's own browser sessions.
 */
final class SessionController
{
    use CurrentUser;

    public function __construct(private readonly SessionRegistry $sessions) {}

    public function index(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        Gate::authorize('viewAny', UserSession::class);

        $request->attributes->set('identity.session_hash', $this->sessions->currentHash($request));

        return ApiResponse::success(SessionResource::collection($this->sessions->listFor($user))->resolve($request));
    }

    public function destroy(
        Request $request,
        string $id,
        AccessRevoker $revoker,
        SessionAuthenticator $authenticator,
        SessionLogger $logger,
    ): JsonResponse {
        $user = $this->currentUser($request);
        // Owner-scoped lookup: another user's session id is simply not found.
        $session = UserSession::query()->where('user_id', $user->id)->findOrFail($id);
        Gate::authorize('delete', $session);

        if ($session->session_hash === $this->sessions->currentHash($request)) {
            $authenticator->logout($request, $user);

            return ApiResponse::noContent();
        }

        $this->sessions->revoke($session);
        $revoker->rotateRememberToken($user);
        $logger->log(SessionEvent::Revoked, $request, $user);

        return ApiResponse::noContent();
    }
}
