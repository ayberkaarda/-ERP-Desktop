<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Policies;

final class ItemCategoryPolicy extends CatalogPolicy
{
    protected function viewPermissions(): array
    {
        return ['item_categories.manage', 'items.view'];
    }

    protected function createPermissions(): array
    {
        return ['item_categories.manage'];
    }
}
