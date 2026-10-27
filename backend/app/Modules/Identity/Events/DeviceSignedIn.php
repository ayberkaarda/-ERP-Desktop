<?php

declare(strict_types=1);

namespace App\Modules\Identity\Events;

final readonly class DeviceSignedIn
{
    public function __construct(public string $deviceId) {}
}
