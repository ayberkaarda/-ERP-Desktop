<?php

declare(strict_types=1);

namespace App\Core\Sync;

use App\Core\Http\ErrorCode;

/**
 * Conflict Inbox decision carried by a new mutation (push.request.schema.json#/$defs/resolution).
 */
final readonly class Resolution
{
    public function __construct(
        /** Idempotency key of the conflict result this resolves. */
        public string $resolves,
        public ErrorCode $code,
        public ConflictChoice $choice,
    ) {}

    /**
     * @return array{resolves: string, code: string, choice: string}
     */
    public function toArray(): array
    {
        return ['resolves' => $this->resolves, 'code' => $this->code->value, 'choice' => $this->choice->value];
    }
}
