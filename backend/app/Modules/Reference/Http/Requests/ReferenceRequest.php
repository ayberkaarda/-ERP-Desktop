<?php

declare(strict_types=1);

namespace App\Modules\Reference\Http\Requests;

use App\Modules\Reference\Data\RecordData;
use App\Modules\Reference\Services\ReferenceSchema;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

final class ReferenceRequest extends FormRequest
{
    /** Rules whose parameter names another field; on PATCH they run on the merged record in the writer. */
    private const array CROSS_FIELD = ['lt', 'lte', 'gt', 'gte', 'after', 'after_or_equal', 'before', 'before_or_equal', 'required_if', 'same', 'different'];

    /** Permission is checked before validation and before any record lookup, so neither leaks existence. */
    public function authorize(): bool
    {
        $resource = $this->route('resource');
        if (! is_string($resource) || ! array_key_exists($resource, ReferenceSchema::MODELS)) {
            return false;
        }
        $class = ReferenceSchema::model($resource);
        $ability = match (true) {
            $this->isMethod('POST') => 'create',
            $this->isMethod('DELETE') => 'deleteAny',
            default => 'updateAny',
        };

        return Gate::allows($ability, [$class, $class]);
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
                $value = array_values(array_filter($value, fn (string $rule): bool => $rule !== 'required' && ! $this->crossField($rule)));
                array_unshift($value, 'sometimes');
                $rules[$key] = $value;
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

    private function crossField(string $rule): bool
    {
        [$name, $parameter] = array_pad(explode(':', $rule, 2), 2, '');

        return in_array($name, self::CROSS_FIELD, true) && preg_match('/^[a-z_]+(,|$)/', $parameter) === 1 && $parameter !== 'today';
    }
}
