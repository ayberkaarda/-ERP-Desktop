<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Resources\Reports;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of a stock report as computed by its service (every number a decimal string); the
 * subclasses document the row shape of each report.
 *
 * @property array<string, string|int|bool|null> $resource
 */
abstract class ReportRowResource extends JsonResource
{
    /** @return array<string, string|int|bool|null> */
    protected function row(): array
    {
        return $this->resource;
    }
}
