<?php

declare(strict_types=1);

namespace Tests\Fixtures;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin FixtureDocument
 */
final class FixtureDocumentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'status' => $this->status,
            'total' => $this->total === null ? null : (string) $this->total,
        ];
    }
}
