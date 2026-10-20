<?php

declare(strict_types=1);

namespace App\Core\Documents;

/**
 * A model whose lifecycle is driven by a StateMachine. See InteractsWithStatus for the default.
 */
interface HasStatus
{
    public function statusColumn(): string;

    public function currentStatus(): string;

    public function applyStatus(string $status): void;
}
