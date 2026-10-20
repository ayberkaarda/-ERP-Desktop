<?php

declare(strict_types=1);

namespace App\Core\Company;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Scopes every query to the active company and stamps company_id on create.
 *
 * @mixin Model
 */
trait BelongsToCompany
{
    public static function bootBelongsToCompany(): void
    {
        static::addGlobalScope(new CompanyScope);

        static::creating(static function (Model $model): void {
            if ($model->getAttribute('company_id') === null) {
                $model->setAttribute('company_id', app(CompanyContext::class)->id());
            }
        });
    }

    /**
     * Explicit escape hatch for cross-company work (console, super admin reports).
     *
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeWithoutCompanyScope(Builder $query): Builder
    {
        return $query->withoutGlobalScope(CompanyScope::class);
    }
}
