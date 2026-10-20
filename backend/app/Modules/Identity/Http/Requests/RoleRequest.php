<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Core\Company\CompanyContext;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Services\PermissionCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class RoleRequest extends FormRequest
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
        $role = $this->route('role');
        $creating = ! $role instanceof Role;
        $unique = Rule::unique('roles', 'name')
            ->where('company_id', app(CompanyContext::class)->id())
            ->where('guard_name', PermissionCatalog::GUARD);

        if ($role instanceof Role) {
            $unique->ignore($role->id);
        }

        return [
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:125', $unique],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'permissions' => ['sometimes', 'array', 'max:500'],
            'permissions.*' => ['string', 'distinct', Rule::in(app(PermissionCatalog::class)->all())],
        ];
    }
}
