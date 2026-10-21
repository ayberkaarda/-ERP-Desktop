<?php

declare(strict_types=1);

namespace App\Modules\Parties\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * DELETE carries the version the client saw (body or query string).
 */
final class VersionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['version' => ['required', 'integer', 'min:1']];
    }
}
