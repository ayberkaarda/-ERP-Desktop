<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Requests;

/**
 * @ignoreSchema POST and PATCH validate differently; the API document keeps one request body per operation.
 */
final class ContactRequest extends ChildRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'version' => $this->versionRule(),
            'name' => [$this->required(), 'string', 'max:200'],
            'title' => ['sometimes', 'nullable', 'string', 'max:100'],
            'email' => ['sometimes', 'nullable', 'string', 'email', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32', 'regex:/\A[0-9+()\-. ]{3,32}\z/'],
            'is_primary' => ['sometimes', 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $email = $this->input('email');

        if (is_string($email)) {
            $this->merge(['email' => trim($email)]);
        }
    }
}
