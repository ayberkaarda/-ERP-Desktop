<?php

declare(strict_types=1);

namespace App\Modules\Identity\Models;

use App\Core\Support\HasUuid7;
use Laravel\Sanctum\PersonalAccessToken as SanctumToken;

class PersonalAccessToken extends SanctumToken
{
    use HasUuid7;
}
