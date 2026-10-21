<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Policies;

/**
 * Price lists; their lines are authorized as view/update of the list.
 */
final class PriceListPolicy extends CatalogPolicy
{
    protected function viewPermissions(): array
    {
        return ['price_lists.view'];
    }

    protected function createPermissions(): array
    {
        return ['price_lists.create'];
    }

    protected function updatePermissions(): array
    {
        return ['price_lists.update'];
    }

    protected function deletePermissions(): array
    {
        return ['price_lists.delete'];
    }
}
