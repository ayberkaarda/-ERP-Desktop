<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services\Ledger;

use App\Modules\Inventory\Enums\MovementType;

/**
 * How a document is posted, beyond what the document itself says.
 */
final readonly class PostOptions
{
    public function __construct(
        public ?string $actor = null,
        public bool $postJournal = true,
        /** Overrides the document's offset event (contract postings). */
        public ?string $offsetEvent = null,
        public ?MovementType $movementType = null,
    ) {}
}
