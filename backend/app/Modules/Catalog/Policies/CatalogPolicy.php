<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Policies;

use App\Models\User;
use App\Modules\Catalog\Models\CatalogModel;

/**
 * Permission sets per ability; subclasses only declare them. Each ability accepts any of its list.
 */
abstract class CatalogPolicy
{
    use ChecksCatalogPermission;

    /** @return list<string> */
    abstract protected function viewPermissions(): array;

    /** @return list<string> */
    abstract protected function createPermissions(): array;

    /** @return list<string> */
    protected function updatePermissions(): array
    {
        return $this->createPermissions();
    }

    /** @return list<string> */
    protected function deletePermissions(): array
    {
        return $this->createPermissions();
    }

    public function viewAny(User $user): bool
    {
        return $this->allowed($user, ...$this->viewPermissions());
    }

    public function view(User $user, CatalogModel $model): bool
    {
        return $this->own($model) && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->allowed($user, ...$this->createPermissions());
    }

    public function update(User $user, CatalogModel $model): bool
    {
        return $this->own($model) && $this->allowed($user, ...$this->updatePermissions());
    }

    public function delete(User $user, CatalogModel $model): bool
    {
        return $this->own($model) && $this->allowed($user, ...$this->deletePermissions());
    }
}
