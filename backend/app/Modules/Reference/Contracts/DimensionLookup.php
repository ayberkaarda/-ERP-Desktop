<?php

declare(strict_types=1);

namespace App\Modules\Reference\Contracts;

interface DimensionLookup
{
    public function exists(string $id): bool;

    public function costCenterExists(string $id): bool;

    public function projectExists(string $id): bool;
}
