<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Resources;

use App\Models\User;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Support\CurrentToken;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin UserDevice
 */
final class DeviceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'ip_address' => $this->ip_address,
            'user_agent' => $this->user_agent,
            'last_used_at' => $this->last_used_at?->toIso8601String(),
            'expires_at' => $this->expires_at->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'is_current' => $this->isCurrent($request),
        ];
    }

    /**
     * True when the request was authenticated by this device's access token. Browser sessions and
     * transient tokens belong to no device.
     */
    private function isCurrent(Request $request): bool
    {
        $user = $request->user();
        $token = $user instanceof User ? CurrentToken::of($user) : null;

        return $token !== null && $this->token_id === (string) $token->getKey();
    }
}
