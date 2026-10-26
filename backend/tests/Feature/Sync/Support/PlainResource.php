<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * id + name of the scope fixtures (SharedRate, GlobalTag).
 */
final class PlainResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return ['id' => $this->resource->getKey(), 'name' => $this->resource->getAttribute('name')];
    }
}
