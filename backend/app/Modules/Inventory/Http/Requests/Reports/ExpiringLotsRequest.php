<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Requests\Reports;

/**
 * `days` (0..3650, default 30): lots expiring within that many days from today;
 * `include_expired` (default true).
 */
final class ExpiringLotsRequest extends InventoryReportRequest
{
    /** @return array<string, mixed> */
    protected function reportRules(): array
    {
        return [
            'days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:3650'],
            'include_expired' => self::boolRule(),
        ];
    }

    public function days(): int
    {
        $days = $this->validated('days');

        return is_numeric($days) ? (int) $days : 30;
    }

    public function includeExpired(): bool
    {
        return $this->flag('include_expired', true);
    }
}
