<?php

declare(strict_types=1);

namespace App\Core\Company;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * @template TModel of Model
 *
 * @implements Scope<TModel>
 */
final class CompanyScope implements Scope
{
    /**
     * @param  Builder<covariant TModel>  $builder
     * @param  TModel  $model
     */
    public function apply(Builder $builder, Model $model): void
    {
        $companyId = app(CompanyContext::class)->idOrNull();
        $column = $model->qualifyColumn('company_id');

        if ($companyId === null) {
            // No active company means no rows, never all companies' rows.
            $builder->whereRaw('false');

            return;
        }

        $builder->where($column, $companyId);
    }
}
