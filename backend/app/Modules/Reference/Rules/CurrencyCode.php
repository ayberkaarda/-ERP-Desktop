<?php

declare(strict_types=1);

namespace App\Modules\Reference\Rules;

use App\Modules\Reference\Contracts\CurrencyLookup;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

final class CurrencyCode implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! app(CurrencyLookup::class)->exists($value)) {
            $fail('reference::messages.invalid_reference')->translate();
        }
    }
}
