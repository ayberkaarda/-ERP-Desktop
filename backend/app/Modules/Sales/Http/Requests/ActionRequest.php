<?php

declare(strict_types=1);

namespace App\Modules\Sales\Http\Requests;

/**
 * Body of the document actions (confirm, send, issue, post, reverse, cancel, ...): all fields are
 * optional here; the services say which an action needs (e.g. reverse needs reason and date).
 * version (optional) guards against acting on a stale copy.
 */
final class ActionRequest extends SalesRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            ...$this->versionRules(false),
            'credit_override_reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'reverse_stock' => ['sometimes', 'boolean'],
        ];
    }

    public function text(string $key): ?string
    {
        $value = $this->validated($key);

        return is_string($value) && trim($value) !== '' ? $value : null;
    }
}
