<?php

declare(strict_types=1);

namespace App\Core\Documents;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Database\Eloquent\Model;

/**
 * Listeners (audit, broadcast, approvals) only ever see committed transitions.
 */
final readonly class DocumentTransitioned implements ShouldDispatchAfterCommit
{
    public function __construct(
        public Model $document,
        public string $documentType,
        public string $from,
        public string $to,
        public ?string $actorId,
    ) {}
}
