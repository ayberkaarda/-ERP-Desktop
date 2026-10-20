<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Requests;

use App\Models\User;
use App\Modules\Identity\Rules\StrongPassword;
use Illuminate\Foundation\Http\FormRequest;

final class PasswordChangeRequest extends FormRequest
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
        $user = $this->user();

        return [
            'current_password' => ['required', 'string', 'max:1000'],
            'password' => [
                'required', 'string', 'max:1000', 'confirmed', 'different:current_password',
                new StrongPassword($user instanceof User ? $user->email : null, $user instanceof User ? $user->name : null),
            ],
        ];
    }
}
