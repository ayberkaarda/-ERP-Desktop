<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Contracts;

interface ApproverResolver
{
    /** @return list<string> User UUIDs belonging to the supplied company. */
    public function resolve(string $companyId, string $type, string $reference): array;
}
