<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

final readonly class ApprovalCompleted implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $requestId,
        public string $companyId,
        public string $documentId,
        public string $documentType,
    ) {}
}
