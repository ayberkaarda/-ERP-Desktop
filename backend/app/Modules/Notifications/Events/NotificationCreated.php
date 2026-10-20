<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Carries plain values only: the queued broadcast runs without a company context,
 * so re-hydrating a company scoped model there would fail.
 */
final class NotificationCreated implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable;
    use InteractsWithSockets;

    public bool $afterCommit = true;

    /**
     * @param  array<string, mixed>  $data
     */
    public function __construct(
        public readonly string $id,
        public readonly string $companyId,
        public readonly string $userId,
        public readonly string $type,
        public readonly array $data,
        public readonly string $createdAt,
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
        return 'notification.created';
    }

    /**
     * Same item shape as GET /notifications.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'data' => $this->data,
            'read_at' => null,
            'created_at' => $this->createdAt,
        ];
    }
}
