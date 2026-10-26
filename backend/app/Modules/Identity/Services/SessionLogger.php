<?php

declare(strict_types=1);

namespace App\Modules\Identity\Services;

use App\Models\User;
use App\Modules\Identity\Enums\SessionEvent;
use App\Modules\Identity\Models\SessionLog;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

final class SessionLogger
{
    public function log(SessionEvent $event, Request $request, ?User $user = null, ?string $email = null): void
    {
        SessionLog::query()->create([
            'user_id' => $user?->id,
            'email' => $email !== null ? Str::limit(mb_strtolower(trim($email)), 254, '') : $user?->email,
            'event' => $event,
            'ip_address' => $request->ip(),
            'user_agent' => Str::limit((string) $request->userAgent(), 500, ''),
            'created_at' => Carbon::now(),
        ]);
    }
}
