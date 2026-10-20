<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DeviceLoginRequest extends FormRequest
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
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', 'max:1000'],
            'two_factor_code' => ['sometimes', 'nullable', 'string', 'max:32'],
            'device_name' => ['required', 'string', 'max:120'],
            'fingerprint' => ['required', 'string', 'min:16', 'max:255'],
        ];
    }
}
