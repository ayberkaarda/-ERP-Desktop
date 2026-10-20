<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Models\User;
use App\Modules\Identity\Models\UserSession;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Contracts\Session\Session;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Session\SessionManager;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

/**
 * Tracks browser sessions per user so they can be listed and revoked. Revoking destroys the
 * session in the configured store (database, redis, ...), not just the tracking row.
 */
final class SessionRegistry
{
    public function __construct(private readonly SessionManager $sessions) {}

    public static function hash(string $sessionId): string
    {
        return hash('sha256', $sessionId);
    }

    public function track(Request $request, User $user, bool $force = false): void
    {
        $session = $this->sessionOf($request);

        if ($session === null) {
            return;
        }

        $id = $session->getId();
        $hash = self::hash($id);
        $now = Carbon::now();
        $row = UserSession::query()->where('session_hash', $hash)->first();

        if ($row instanceof UserSession) {
            if ($row->user_id !== $user->id) {
                // A session id now belongs to someone else (re-login without regeneration); restart tracking.
                $row->delete();
            } elseif ($force || $row->last_active_at->lt($now->copy()->subSeconds($this->touchSeconds()))) {
                $row->forceFill(['last_active_at' => $now, 'ip_address' => $request->ip()])->save();

                return;
            } else {
                return;
            }
        }

        UserSession::query()->create([
            'user_id' => $user->id,
            'session_hash' => $hash,
            'session_id_encrypted' => Crypt::encryptString($id),
            'ip_address' => $request->ip(),
            'user_agent' => Str::limit((string) $request->userAgent(), 500, ''),
            'last_active_at' => $now,
        ]);
    }

    public function currentHash(Request $request): ?string
    {
        $session = $this->sessionOf($request);

        return $session === null ? null : self::hash($session->getId());
    }

    /**
     * Live sessions of the user, most recent first.
     *
     * @return Collection<int, UserSession>
     */
    public function listFor(User $user): Collection
    {
        return UserSession::query()
            ->where('user_id', $user->id)
            ->where('last_active_at', '>=', Carbon::now()->subMinutes($this->lifetimeMinutes()))
            ->orderByDesc('last_active_at')
            ->get();
    }

    public function revoke(UserSession $row): void
    {
        try {
            $this->sessions->driver()->getHandler()->destroy(Crypt::decryptString($row->session_id_encrypted));
        } catch (DecryptException) {
            // Key rotated: the stored session cannot be addressed any more, drop the row anyway.
        }

        $row->delete();
    }

    /**
     * @return int number of sessions revoked
     */
    public function revokeAll(User $user, ?string $exceptHash = null): int
    {
        $rows = UserSession::query()->where('user_id', $user->id)
            ->when($exceptHash !== null, fn ($q) => $q->where('session_hash', '!=', $exceptHash))
            ->get();

        foreach ($rows as $row) {
            $this->revoke($row);
        }

        return $rows->count();
    }

    public function forgetCurrent(Request $request): void
    {
        $hash = $this->currentHash($request);

        if ($hash !== null) {
            UserSession::query()->where('session_hash', $hash)->delete();
        }
    }

    private function sessionOf(Request $request): ?Session
    {
        if (! $request->hasSession()) {
            return null;
        }

        $session = $request->session();

        return $session->isStarted() ? $session : null;
    }

    private function touchSeconds(): int
    {
        $value = config('identity.sessions.touch_seconds', 60);

        return is_numeric($value) ? (int) $value : 60;
    }

    private function lifetimeMinutes(): int
    {
        $value = config('session.lifetime', 120);

        return is_numeric($value) ? (int) $value : 120;
    }
}
