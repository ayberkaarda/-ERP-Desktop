<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Http\ErrorCode;
use App\Core\Sync\SyncConflict;

/**
 * What the conflict resolver decided for a mutation against its locked target.
 */
final readonly class Decision
{
    /**
     * @param  list<string>  $mergedFields
     * @param  list<string>|null  $effectiveFields  set when the write is a merge over newer server changes; columns outside it must not change
     */
    private function __construct(
        public ?int $version = null,
        public array $mergedFields = [],
        public ?array $effectiveFields = null,
        public ?SyncConflict $conflict = null,
        public ?ErrorCode $rejection = null,
    ) {}

    public static function apply(int $version): self
    {
        return new self($version);
    }

    /**
     * @param  list<string>  $mergedFields
     * @param  list<string>  $effectiveFields
     */
    public static function merge(int $currentVersion, array $mergedFields, array $effectiveFields): self
    {
        return new self($currentVersion, $mergedFields, $effectiveFields);
    }

    public static function conflict(SyncConflict $conflict): self
    {
        return new self(conflict: $conflict);
    }

    public static function reject(ErrorCode $code): self
    {
        return new self(rejection: $code);
    }
}
