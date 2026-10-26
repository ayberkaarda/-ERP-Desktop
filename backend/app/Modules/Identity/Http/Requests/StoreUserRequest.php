<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Modules\Identity\Rules\StrongPassword;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreUserRequest extends FormRequest
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
        return [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:254', Rule::unique('users', 'email')],
            'password' => ['required', 'string', 'max:1000', new StrongPassword($this->string('email')->toString(), $this->string('name')->toString())],
            'locale' => ['sometimes', 'string', Rule::in(['tr', 'en', 'de', 'fr'])],
            'roles' => ['sometimes', 'array', 'max:50'],
            'roles.*' => ['string', 'max:125', 'distinct'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('email'))) {
            $this->merge(['email' => mb_strtolower(trim($this->input('email')))]);
        }
    }
}
