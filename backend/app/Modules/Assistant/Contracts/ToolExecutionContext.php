<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Contracts;

use Closure;

final class ToolExecutionContext
{
    /** @var list<string> */
    private array $approvedCalls = [];

    /**
     * @template T
     *
     * @param  list<string>  $ids
     * @param  Closure(): T  $callback
     * @return T
     */
    public function withApprovedCalls(array $ids, Closure $callback): mixed
    {
        $previous = $this->approvedCalls;
        $this->approvedCalls = $ids;
        try {
            return $callback();
        } finally {
            $this->approvedCalls = $previous;
        }
    }

    public function isApproved(?string $id): bool
    {
        return $id !== null && in_array($id, $this->approvedCalls, true);
    }
}
