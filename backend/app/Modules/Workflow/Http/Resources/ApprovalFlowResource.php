<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Resources;

use App\Modules\Workflow\Models\ApprovalFlow;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ApprovalFlow */
final class ApprovalFlowResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id, 'company_id' => $this->company_id,
            'document_type' => $this->document_type, 'name' => $this->name,
            'is_active' => $this->is_active, 'allow_self_approval' => $this->allow_self_approval,
            'version' => $this->version,
            'steps' => ApprovalFlowStepResource::collection($this->whenLoaded('steps')),
        ];
    }
}
