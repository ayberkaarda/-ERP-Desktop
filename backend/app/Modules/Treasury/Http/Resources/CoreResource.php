<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Http\Resources;

use App\Modules\Treasury\Models\TreasuryRecord;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin TreasuryRecord */
final class CoreResource extends JsonResource
{
    /** @return array<string,mixed> */
    public function toArray(Request $request): array
    {
        return $this->resource->toArray();
    }
}
