<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Models\User;
use Illuminate\Http\Request;

trait CurrentUser
{
    protected function currentUser(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        return $user;
    }
}
