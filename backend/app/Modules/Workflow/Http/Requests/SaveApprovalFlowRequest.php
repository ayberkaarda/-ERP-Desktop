<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Requests;

use Brick\Math\BigDecimal;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;
use Illuminate\Validation\Validator;

final class SaveApprovalFlowRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'document_type' => [$required, 'string', 'max:100', 'regex:/^[a-zA-Z0-9_.-]+$/'],
            'is_active' => ['sometimes', 'boolean'],
            'allow_self_approval' => ['sometimes', 'boolean'],
            'version' => [$this->isMethod('POST') ? 'prohibited' : 'required', 'integer', 'min:1'],
            'steps' => [$required, 'array', 'min:1', 'max:100'],
            'steps.*' => ['required', 'array:position,mode,approver_type,approver_ref,min_amount,max_amount'],
            'steps.*.position' => ['required', 'integer', 'min:1', 'distinct:strict'],
            'steps.*.mode' => ['required', 'in:any_of,all_of'],
            'steps.*.approver_type' => ['required', 'in:role,user'],
            'steps.*.approver_ref' => ['required', 'string', 'max:255'],
            'steps.*.min_amount' => ['nullable', 'string', 'regex:/^-?\d{1,16}(\.\d{1,4})?$/'],
            'steps.*.max_amount' => ['nullable', 'string', 'regex:/^-?\d{1,16}(\.\d{1,4})?$/'],
        ];
    }

    /** @return list<\Closure(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            /** @var list<array{approver_type: string, approver_ref: string, min_amount?: string|null, max_amount?: string|null}> $steps */
            $steps = $this->input('steps', []);
            foreach ($steps as $index => $step) {
                if ($step['approver_type'] === 'user' && ! Str::isUuid($step['approver_ref'])) {
                    $validator->errors()->add("steps.$index.approver_ref", __('workflow::messages.user_uuid'));
                }
                if (isset($step['min_amount'], $step['max_amount'])
                    && BigDecimal::of($step['min_amount'])->isGreaterThan($step['max_amount'])) {
                    $validator->errors()->add("steps.$index.max_amount", __('workflow::messages.invalid_range'));
                }
            }
        }];
    }
}
