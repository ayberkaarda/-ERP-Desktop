<?php

declare(strict_types=1);

namespace App\Modules\Reference\Policies;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use App\Modules\Reference\Models\Currency;
use App\Modules\Reference\Models\ExchangeRate;
use App\Modules\Reference\Models\TaxCode;
use Illuminate\Database\Eloquent\Model;

final class ReferencePolicy
{
    /** @param class-string<Model> $model */
    public function viewAny(User $user, string $model): bool
    {
        return $this->allowed($user, $model, 'view');
    }

    public function view(User $user, Model $record): bool
    {
        return $this->visible($record) && $this->allowed($user, $record::class, 'view');
    }

    /** @param class-string<Model> $model */
    public function create(User $user, string $model): bool
    {
        return $model !== Currency::class && $this->allowed($user, $model, 'create');
    }

    public function update(User $user, Model $record): bool
    {
        return $this->writable($record) && $this->allowed($user, $record::class, 'update');
    }

    public function delete(User $user, Model $record): bool
    {
        return ! $record instanceof Currency && ! $record instanceof ExchangeRate
            && $this->writable($record) && $this->allowed($user, $record::class, 'delete');
    }

    private function visible(Model $record): bool
    {
        $company = $record->getAttribute('company_id');

        return $company === null || $company === app(CompanyContext::class)->idOrNull();
    }

    private function writable(Model $record): bool
    {
        return $this->visible($record) && (! $record instanceof TaxCode || $record->getAttribute('company_id') !== null);
    }

    /** @param class-string<Model> $model */
    private function allowed(User $user, string $model, string $action): bool
    {
        $company = app(CompanyContext::class)->idOrNull();
        $resource = (new $model)->getTable();
        $permission = $resource.'.'.($model === ExchangeRate::class && $action !== 'view' ? 'manage' : $action);
        if ($resource === 'locations') {
            $permission = 'warehouses.'.($action === 'view' ? 'view' : 'update');
        }

        return $company !== null && app(CompanyAuthorizer::class)->allows($user, $permission, $company);
    }
}
