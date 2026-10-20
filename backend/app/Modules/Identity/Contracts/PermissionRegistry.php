<?php

declare(strict_types=1);

namespace App\Modules\Identity\Contracts;

/**
 * Modules declare their permission names (`<resource>.<action>`) here from their provider's register().
 */
interface PermissionRegistry
{
    /**
     * @param  list<string>  $names
     */
    public function register(string $module, array $names): void;

    /**
     * @return array<string, list<string>>
     */
    public function grouped(): array;

    /**
     * @return list<string>
     */
    public function all(): array;
}
