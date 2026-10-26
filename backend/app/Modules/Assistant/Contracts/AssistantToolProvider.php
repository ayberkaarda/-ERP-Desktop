<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Contracts;

use App\Models\User;

interface AssistantToolProvider
{
    /** @return list<ErpTool> */
    public function tools(User $user): array;
}
