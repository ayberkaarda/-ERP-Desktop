<?php

declare(strict_types=1);

namespace App\Modules\Files\Http\Resources;

use App\Modules\Files\Models\File;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Never exposes disk or storage path.
 *
 * @property File $resource
 */
final class FileResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            'original_name' => $this->resource->original_name,
            'mime' => $this->resource->mime,
            'size' => $this->resource->size,
            'sha256' => $this->resource->sha256,
            'uploaded_by' => $this->resource->uploaded_by,
            'attachable_type' => $this->resource->attachable_type,
            'attachable_id' => $this->resource->attachable_id,
            'created_at' => $this->resource->created_at->toIso8601String(),
        ];
    }
}
