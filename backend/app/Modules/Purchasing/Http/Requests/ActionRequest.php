<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Http\Requests;

/**
 * Body of the document actions (submit, send, post, book, reverse, cancel, ship, debit, ...): all
 * fields are optional here; the services say which an action needs (reverse needs reason and date).
 * version (optional) guards against acting on a stale copy.
 */
final class ActionRequest extends PurchasingRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            ...$this->versionRules(false),
            'match_override_reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
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
