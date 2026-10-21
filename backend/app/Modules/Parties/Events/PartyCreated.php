<?php

declare(strict_types=1);

namespace App\Modules\Parties\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class PartyCreated implements ShouldDispatchAfterCommit
{
    public function __construct(public string $partyId, public string $companyId) {}
}
