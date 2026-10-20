<?php

declare(strict_types=1);

namespace App\Modules\Organization\Http\Requests;

use App\Core\Company\CompanyContext;
use App\Modules\Organization\Models\Department;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Every reference (branch, parent, manager) must belong to the active company.
 */
final class DepartmentRequest extends FormRequest
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
        $company = app(CompanyContext::class)->id();
        $department = $this->route('department');
        $unique = Rule::unique('departments', 'code')->where('company_id', $company);
        $parent = Rule::exists('departments', 'id')->where('company_id', $company)->whereNull('deleted_at');

        if ($department instanceof Department) {
            $unique->ignore($department->id);
            $parent->whereNot('id', $department->id);
        }

        $required = $department instanceof Department ? 'sometimes' : 'required';

        return [
            'code' => [$required, 'string', 'max:32', $unique],
            'name' => [$required, 'string', 'max:200'],
            'branch_id' => ['bail', 'sometimes', 'nullable', 'uuid', Rule::exists('branches', 'id')->where('company_id', $company)->whereNull('deleted_at')],
            'parent_id' => ['bail', 'sometimes', 'nullable', 'uuid', $parent],
            'manager_user_id' => ['bail', 'sometimes', 'nullable', 'uuid', Rule::exists('company_user', 'user_id')->where('company_id', $company)],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
