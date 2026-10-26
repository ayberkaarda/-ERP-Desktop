<?php

declare(strict_types=1);

namespace App\Modules\Reference\Services;

final class NullLookup
{
    public function exists(string $id): bool
    {
        return false;
    }

    public function hasMovements(string $id): bool
    {
        return false;
    }

    public function find(string $id): null
    {
        return null;
    }
}
