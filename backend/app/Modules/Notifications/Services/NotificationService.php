<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Services;

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Notifications\Events\NotificationCreated;
use App\Modules\Notifications\Models\Notification;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Support\Carbon;
use InvalidArgumentException;

final class NotificationService implements Notifier
{
    public function __construct(
        private readonly Dispatcher $events,
        private readonly MembershipChecker $membership,
        private readonly CompanyContext $company,
    ) {}

    /**
     * Stores a notification for a user of the active company and broadcasts it after commit.
     *
     * @param  array<string, mixed>  $data
     */
    public function notify(Authenticatable|string $userId, string $type, array $data): string
    {
        $id = $userId instanceof Authenticatable ? $userId->getAuthIdentifier() : $userId;

        if (! is_string($id) || $id === '') {
            throw new InvalidArgumentException('Notification recipient must have a string id.');
        }

        if (! is_string($data['title'] ?? null) || ! is_string($data['body'] ?? null)) {
            throw new InvalidArgumentException('Notification data needs string title and body.');
        }

        // A recipient outside the active company must never get its data or its broadcast.
        if (! $this->membership->isMember($id, $this->company->id())) {
            throw new ApiException(ErrorCode::CompanyForbidden);
        }

        $notification = Notification::query()->create(['user_id' => $id, 'type' => $type, 'data' => $data]);

        $this->events->dispatch(new NotificationCreated(
            $notification->id,
            $notification->company_id,
            $id,
            $type,
            $data,
            Carbon::parse($notification->created_at)->toIso8601String(),
        ));

        return $notification->id;
    }
}
