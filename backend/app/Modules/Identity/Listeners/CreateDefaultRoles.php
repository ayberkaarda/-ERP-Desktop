<?php

declare(strict_types=1);

namespace App\Modules\Identity\Listeners;

use App\Modules\Identity\Services\DefaultRoles;
use App\Modules\Organization\Events\CompanyCreated;

final class CreateDefaultRoles
{
    public function __construct(private readonly DefaultRoles $roles) {}

    public function handle(CompanyCreated $event): void
    {
        $this->roles->ensureFor($event->companyId);
    }
}
