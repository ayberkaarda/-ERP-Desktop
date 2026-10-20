<?php

declare(strict_types=1);

namespace App\Modules\Settings\Policies;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Gate;

final class SettingPolicy
{
    public function viewAny(Authenticatable $user): bool
    {
        return Gate::forUser($user)->allows('settings.view');
    }

    public function update(Authenticatable $user): bool
    {
        return Gate::forUser($user)->allows('settings.update');
    }
}
