<?php

declare(strict_types=1);

namespace App\Modules\Parties\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * Also raised when DELETE deactivates a party that is still in use.
 */
final readonly class PartyUpdated implements ShouldDispatchAfterCommit
{
    /**
     * @param  list<string>  $changed  attribute names that changed
     */
    public function __construct(public string $partyId, public string $companyId, public array $changed) {}
}
