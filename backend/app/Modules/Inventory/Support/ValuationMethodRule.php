<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Support;

use App\Core\Company\CompanyContext;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Facades\DB;

/**
 * The valuation method can change only while the company has no stock movements: costs already
 * booked under one method cannot be re-layered under the other.
 */
final class ValuationMethodRule implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $company = app(CompanyContext::class)->idOrNull();
        $current = app(InventorySettings::class)->valuationMethod()->value;

        if ($company === null || $value === $current) {
            return;
        }

        if (DB::table('stock_movements')->where('company_id', $company)->exists()) {
            $fail(Messages::get('valuation_method_locked'));
        }
    }
}
