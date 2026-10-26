<?php

declare(strict_types=1);

namespace App\Core\Company;

use Closure;

/**
 * Privileged escape hatch from BelongsToCompany write checks. Only system code may use it
 * (seeders, imports, super admin tooling that moves data between companies); never call it
 * with request input that was not authorised for every company involved.
 */
final class CompanyGuard
{
    private static int $bypassDepth = 0;

    /**
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public static function bypass(Closure $fn): mixed
    {
        self::$bypassDepth++;

        try {
            return $fn();
        } finally {
            self::$bypassDepth--;
        }
    }

    public static function bypassed(): bool
    {
        return self::$bypassDepth > 0;
    }
}
