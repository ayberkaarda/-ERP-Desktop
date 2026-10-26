<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin User
 */
final class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'locale' => $this->locale,
            'is_super_admin' => $this->is_super_admin,
            'is_active' => $this->is_active,
            'must_change_password' => $this->must_change_password,
            'two_factor_enabled' => $this->hasTwoFactorEnabled(),
            'roles' => $this->whenLoaded('roles', fn (): array => $this->roles->map(fn ($role): array => ['id' => $role->getKey(), 'name' => $role->getAttribute('name')])->values()->all()),
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'deactivated_at' => $this->deactivated_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
