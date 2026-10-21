<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Requests;

use App\Modules\Parties\Enums\AddressType;
use Illuminate\Validation\Rule;

/**
 * @ignoreSchema POST and PATCH validate differently; the API document keeps one request body per operation.
 */
final class AddressRequest extends ChildRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        $required = $this->required();

        return [
            'version' => $this->versionRule(),
            'type' => [$required, 'string', Rule::in(AddressType::values())],
            'label' => ['sometimes', 'nullable', 'string', 'max:100'],
            'line1' => [$required, 'string', 'max:255'],
            'line2' => ['sometimes', 'nullable', 'string', 'max:255'],
            'district' => ['sometimes', 'nullable', 'string', 'max:100'],
            'city' => ['sometimes', 'nullable', 'string', 'max:100'],
            'postal_code' => ['sometimes', 'nullable', 'string', 'max:20'],
            'country' => ['sometimes', 'string', 'regex:/\A[A-Z]{2}\z/'],
            'is_default' => ['sometimes', 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->upper(['country']);
    }
}
