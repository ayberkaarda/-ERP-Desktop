<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Resources;

use App\Modules\Identity\Models\Activity;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Activity
 */
final class ActivityResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $changes = $this->attribute_changes;

        return [
            'id' => $this->id,
            'log_name' => $this->log_name,
            'event' => $this->event,
            'description' => $this->description,
            'subject_type' => $this->subject_type,
            'subject_id' => $this->subject_id,
            'causer_type' => $this->causer_type,
            'causer_id' => $this->causer_id,
            // Only the display name: no e-mail or other personal data of the acting user.
            'causer' => $this->causerSummary(),
            'old' => $changes?->get('old'),
            'attributes' => $changes?->get('attributes'),
            'properties' => $this->properties,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{id: string, name: string}|null
     */
    private function causerSummary(): ?array
    {
        $causer = $this->resource->relationLoaded('causer') ? $this->resource->getRelation('causer') : null;

        if (! $causer instanceof Model) {
            return null;
        }

        $name = $causer->getAttribute('name');

        return ['id' => (string) $causer->getKey(), 'name' => is_string($name) ? $name : ''];
    }
}
