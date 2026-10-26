<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

final class ItemUpdated implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    /**
     * @param  list<string>  $changed  attribute names
     */
    public function __construct(
        public readonly string $itemId,
        public readonly string $companyId,
        public readonly array $changed,
    ) {}
}
