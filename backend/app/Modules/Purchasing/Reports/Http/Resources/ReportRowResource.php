<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of a purchasing report as computed by its service (every number a decimal string, counts and
 * day figures integers); the row shapes are listed per report in the controller/service docs.
 *
 * @property array<string, string|int|null> $resource
 */
final class ReportRowResource extends JsonResource
{
    /** @return array<string, string|int|null> */
    public function toArray(Request $request): array
    {
        return $this->resource;
    }
}
