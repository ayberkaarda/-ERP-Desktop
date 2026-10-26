<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin FixtureNote
 */
final class FixtureNoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'status' => $this->status,
            'version' => $this->version,
            'lines' => $this->whenLoaded('lines', fn () => $this->lines->map(static fn (FixtureNoteLine $line): array => [
                'id' => $line->id,
                'position' => $line->position,
                'body' => $line->body,
            ])->all()),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
