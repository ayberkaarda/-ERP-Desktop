<?php

declare(strict_types=1);

namespace App\Modules\Files\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class UploadFileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The file itself is checked by FileService (size and type map to dedicated error codes).
     *
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'attachable_type' => ['nullable', 'string', 'max:150', 'required_with:attachable_id'],
            'attachable_id' => ['nullable', 'uuid', 'required_with:attachable_type'],
        ];
    }
}
