<?php

declare(strict_types=1);

namespace App\Modules\Settings\Contracts;

/**
 * Typed read access to the active company's settings; falls back to the registered default.
 */
interface SettingsReader
{
    public function get(string $key): mixed;
}
