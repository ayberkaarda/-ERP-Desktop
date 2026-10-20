<?php

declare(strict_types=1);

namespace App\Modules\Notifications;

use App\Core\Modules\ModuleServiceProvider;
use App\Modules\Notifications\Contracts\Notifier;
use App\Modules\Notifications\Models\Notification;
use App\Modules\Notifications\Policies\NotificationPolicy;
use App\Modules\Notifications\Services\NotificationService;
use Illuminate\Support\Facades\Gate;

final class NotificationsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(Notifier::class, NotificationService::class);
    }

    public function boot(): void
    {
        parent::boot();

        Gate::policy(Notification::class, NotificationPolicy::class);
    }
}
