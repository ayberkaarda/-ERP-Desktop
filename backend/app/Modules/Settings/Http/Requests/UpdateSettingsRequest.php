<?php

declare(strict_types=1);

namespace App\Modules\Settings\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class UpdateSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Values are validated per key by the service (keys contain dots).
     *
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'settings' => ['required', 'array', 'min:1', 'max:100'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function changes(): array
    {
        /** @var array<string, mixed> */
        return $this->validated('settings');
    }
}
