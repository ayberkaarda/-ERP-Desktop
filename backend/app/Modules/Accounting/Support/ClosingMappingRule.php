<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Support;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Shape of accounting.closing_mapping; unknown keys are refused so typos do not pass silently.
 */
final class ClosingMappingRule implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $fail = static function () use ($fail): void {
            $fail(Messages::get('closing_mapping_invalid'));
        };

        if (! is_array($value) || array_diff(array_keys($value), array_keys(AccountingSettings::DEFAULT_CLOSING)) !== []) {
            $fail();

            return;
        }

        foreach (['result_account', 'net_result_account', 'profit_account', 'loss_account'] as $key) {
            if (array_key_exists($key, $value) && (! is_string($value[$key]) || $value[$key] === '' || strlen($value[$key]) > 32)) {
                $fail();

                return;
            }
        }

        $groups = $value['income_statement_groups'] ?? [6, 7];
        $taxes = $value['tax_accounts'] ?? [];

        if (! is_array($groups) || $groups === [] || array_filter($groups, static fn (mixed $g): bool => ! is_int($g) || $g < 1 || $g > 9) !== []
            || ! is_array($taxes) || array_filter($taxes, static fn (mixed $t): bool => ! is_string($t) || $t === '') !== []) {
            $fail();
        }
    }
}
