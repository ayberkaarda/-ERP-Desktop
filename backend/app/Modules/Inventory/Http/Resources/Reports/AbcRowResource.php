<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Request;

/**
 * ABC row: rank by value, class A/B/C, share and cumulative share in percent (scale 4).
 */
final class AbcRowResource extends ReportRowResource
{
    /** @return array{rank: int, class: string, item_id: string, item_code: string|null, item_name: string|null, base_unit_id: string|null, category_id: string|null, quantity: string, value: string, share: string, cumulative_share: string} */
    public function toArray(Request $request): array
    {
        /** @var array{rank: int, class: string, item_id: string, item_code: string|null, item_name: string|null, base_unit_id: string|null, category_id: string|null, quantity: string, value: string, share: string, cumulative_share: string} */
        return $this->row();
    }
}
