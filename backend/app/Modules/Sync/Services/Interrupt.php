<?php

declare(strict_types=1);

namespace App\Modules\Sync\Services;

use App\Core\Sync\WriteOutcome;
use RuntimeException;

/**
 * Carries an outcome out of a database transaction so the transaction rolls back.
 *
 * - stored = false: the whole mutation transaction is undone, the idempotency claim with it
 *   (authorization refusals, reused keys: never stored, SYNC-PROTOCOL "İşleme" step 5).
 * - stored = true: only the business write's savepoint is undone; the outcome is still stored.
 */
final class Interrupt extends RuntimeException
{
    public function __construct(public readonly WriteOutcome $outcome, public readonly bool $stored)
    {
        parent::__construct('Sync mutation interrupted.');
    }

    public static function unstored(WriteOutcome $outcome): self
    {
        return new self($outcome, false);
    }

    public static function rollback(WriteOutcome $outcome): self
    {
        return new self($outcome, true);
    }
}
