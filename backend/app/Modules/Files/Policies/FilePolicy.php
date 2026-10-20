<?php

declare(strict_types=1);

namespace App\Modules\Files\Policies;

use App\Modules\Files\Models\File;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Gate;

final class FilePolicy
{
    public function viewAny(Authenticatable $user): bool
    {
        return Gate::forUser($user)->allows('files.view');
    }

    public function view(Authenticatable $user, File $file): bool
    {
        return Gate::forUser($user)->allows('files.view');
    }

    public function create(Authenticatable $user): bool
    {
        return Gate::forUser($user)->allows('files.create');
    }

    public function delete(Authenticatable $user, File $file): bool
    {
        return Gate::forUser($user)->allows('files.delete');
    }
}
