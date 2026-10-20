<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DecisionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'decision' => ['required', 'in:approve,reject'],
            'comment' => ['nullable', 'string', 'max:5000'],
            'version' => ['required', 'integer', 'min:1'],
            'step' => ['required', 'integer', 'min:1'],
        ];
    }
}
