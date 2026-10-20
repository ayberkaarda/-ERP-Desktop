<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Resources;

use App\Modules\Workflow\Models\ApprovalFlowStep;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ApprovalFlowStep */
final class ApprovalFlowStepResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id, 'position' => $this->position, 'mode' => $this->mode,
            'approver_type' => $this->approver_type, 'approver_ref' => $this->approver_ref,
            'min_amount' => $this->min_amount, 'max_amount' => $this->max_amount,
        ];
    }
}
