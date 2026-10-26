<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Database\factories;

use App\Modules\Workflow\Models\ApprovalFlow;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ApprovalFlow> */
final class ApprovalFlowFactory extends Factory
{
    protected $model = ApprovalFlow::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'name' => $this->faker->words(3, true),
            'document_type' => 'document_'.str_replace('-', '_', $this->faker->uuid()),
            'is_active' => true,
            'allow_self_approval' => false,
        ];
    }
}
