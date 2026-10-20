<?php

declare(strict_types=1);

namespace App\Core\Company;

use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Scopes every query to the active company and owns company_id writes:
 * - create: company_id comes from the active company; an explicit value must equal it,
 * - update: company_id is immutable.
 * Both rules (and the missing-context rule) are lifted only inside CompanyGuard::bypass().
 * Reads across companies use withoutCompanyScope().
 *
 * @mixin Model
 */
trait BelongsToCompany
{
    public static function bootBelongsToCompany(): void
    {
        static::addGlobalScope(new CompanyScope);

        static::creating(static function (Model $model): void {
            $explicit = $model->getAttribute('company_id');

            if (CompanyGuard::bypassed() && $explicit !== null) {
                return;
            }

            $active = app(CompanyContext::class)->id();

            if ($explicit === null) {
                $model->setAttribute('company_id', $active);
            } elseif ($explicit !== $active) {
                throw new ApiException(ErrorCode::CompanyForbidden);
            }
        });

        static::updating(static function (Model $model): void {
            if ($model->isDirty('company_id') && ! CompanyGuard::bypassed()) {
                throw new ApiException(ErrorCode::CompanyForbidden);
            }
        });
    }

    /**
     * Explicit escape hatch for cross-company reads (console, super admin reports).
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeWithoutCompanyScope(Builder $query): Builder
    {
        return $query->withoutGlobalScope(CompanyScope::class);
    }
}
