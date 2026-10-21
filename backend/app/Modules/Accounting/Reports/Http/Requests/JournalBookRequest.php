<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Http\Requests;

/** page/per_page count entries (max 500 per page). */
final class JournalBookRequest extends ReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return $this->paginationRules();
    }
}
