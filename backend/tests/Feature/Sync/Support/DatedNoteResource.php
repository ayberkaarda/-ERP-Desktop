<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin DatedNote
 */
final class DatedNoteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'note_date' => substr((string) $this->note_date, 0, 10),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
