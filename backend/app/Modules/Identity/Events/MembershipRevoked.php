<?php

declare(strict_types=1);

namespace App\Modules\Identity\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Tells the user's open clients to leave a company's channels after losing membership; the next
 * subscription auth is refused anyway.
 */
final class MembershipRevoked implements ShouldBroadcastNow, ShouldDispatchAfterCommit
{
    use Dispatchable;
    use InteractsWithSockets;

    public function __construct(
        public readonly string $userId,
        public readonly string $companyId,
    ) {}

    /**
     * @return list<PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [new PrivateChannel('user.'.$this->userId)];
    }

    public function broadcastAs(): string
    {
        return 'membership.revoked';
    }

    /**
     * @return array<string, string>
     */
    public function broadcastWith(): array
    {
        return ['company_id' => $this->companyId];
    }
}
