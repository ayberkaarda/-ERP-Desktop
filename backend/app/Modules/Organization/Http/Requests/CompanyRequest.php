<?php

declare(strict_types=1);

namespace App\Modules\Organization\Http\Requests;

use App\Modules\Organization\Models\Company;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class CompanyRequest extends FormRequest
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
        $company = $this->route('company');
        $creating = ! $company instanceof Company;
        $unique = Rule::unique('companies', 'code');

        if ($company instanceof Company) {
            $unique->ignore($company->id);
        }

        $required = $creating ? 'required' : 'sometimes';

        return [
            'code' => [$required, 'string', 'max:32', 'regex:/^[A-Za-z0-9_-]+$/', $unique],
            'name' => [$required, 'string', 'max:200'],
            'legal_name' => ['sometimes', 'nullable', 'string', 'max:300'],
            'tax_number' => ['sometimes', 'nullable', 'string', 'max:32'],
            'tax_office' => ['sometimes', 'nullable', 'string', 'max:100'],
            'email' => ['sometimes', 'nullable', 'email', 'max:254'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'country_code' => ['sometimes', 'string', 'size:2', 'alpha'],
            'base_currency' => ['sometimes', 'string', 'size:3', 'alpha'],
            'timezone' => ['sometimes', 'string', 'timezone:all'],
            'locale' => ['sometimes', 'string', Rule::in(['tr', 'en', 'de', 'fr'])],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
