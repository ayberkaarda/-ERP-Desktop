<?php

declare(strict_types=1);

namespace App\Modules\Organization\Http\Requests;

use App\Core\Company\CompanyContext;
use App\Modules\Organization\Models\Branch;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class BranchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $branch = $this->route('branch');
        $unique = Rule::unique('branches', 'code')->where('company_id', app(CompanyContext::class)->id());

        if ($branch instanceof Branch) {
            $unique->ignore($branch->id);
        }

        $required = $branch instanceof Branch ? 'sometimes' : 'required';

        return [
            'code' => [$required, 'string', 'max:32', $unique],
            'name' => [$required, 'string', 'max:200'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
