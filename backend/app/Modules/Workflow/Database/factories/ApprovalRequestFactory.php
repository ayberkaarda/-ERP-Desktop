<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Database\factories;

use App\Modules\Workflow\Models\ApprovalRequest;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<ApprovalRequest> */
final class ApprovalRequestFactory extends Factory
{
    protected $model = ApprovalRequest::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        $actor = (string) Str::uuid7();

        return [
            'flow_id' => null,
            'document_type' => 'purchase_order',
            'document_id' => (string) Str::uuid7(),
            'status' => 'pending',
            'current_step' => 1,
            'amount' => '100.0000',
            'requested_by' => (string) Str::uuid7(),
            'allow_self_approval' => false,
            'steps' => [['position' => 1, 'mode' => 'any_of', 'approvers' => [$actor]]],
        ];
    }
}
