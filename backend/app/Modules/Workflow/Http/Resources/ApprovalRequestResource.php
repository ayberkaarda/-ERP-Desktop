<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Resources;

use App\Modules\Workflow\Models\ApprovalRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ApprovalRequest */
final class ApprovalRequestResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id, 'company_id' => $this->company_id, 'flow_id' => $this->flow_id,
            'document_type' => $this->document_type, 'document_id' => $this->document_id,
            'status' => $this->status, 'current_step' => $this->current_step,
            'amount' => $this->amount, 'requested_by' => $this->requested_by,
            'version' => $this->version, 'revision' => $this->revision, 'steps' => $this->steps,
            'decisions' => ApprovalDecisionResource::collection($this->whenLoaded('decisions')),
        ];
    }
}
