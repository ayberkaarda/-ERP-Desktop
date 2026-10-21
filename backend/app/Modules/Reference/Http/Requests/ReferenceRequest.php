<?php

declare(strict_types=1);

namespace App\Modules\Reference\Http\Requests;

use App\Modules\Reference\Data\RecordData;
use App\Modules\Reference\Services\ReferenceSchema;
use Illuminate\Foundation\Http\FormRequest;

final class ReferenceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        if ($this->isMethod('DELETE')) {
            return ['version' => ['required', 'integer', 'min:1']];
        }
        $resource = $this->route('resource');
        $rules = ReferenceSchema::rules(is_string($resource) ? $resource : '');
        if ($this->isMethod('PATCH') || $this->isMethod('PUT')) {
            foreach ($rules as $key => $value) {
                $rules[$key] = array_values(array_diff($value, ['required']));
                array_unshift($rules[$key], 'sometimes');
            }
        }
        if (! $this->isMethod('POST')) {
            $rules['version'] = ['required', 'integer', 'min:1'];
        }

        return $rules;
    }

    public function toDto(): RecordData
    {
        $data = $this->validated();
        $version = isset($data['version']) ? (int) $data['version'] : null;
        unset($data['version']);

        return new RecordData($data, $version);
    }
}
