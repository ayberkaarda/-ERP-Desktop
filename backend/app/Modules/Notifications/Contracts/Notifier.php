<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Contracts;

/**
 * What other modules depend on to notify a user of the active company.
 */
interface Notifier
{
    /**
     * $data must contain localized string `title` and `body`, and may contain `url`.
     *
     * @param  array<string, mixed>  $data
     * @return string the notification id
     */
    public function notify(string $userId, string $type, array $data): string;
}
