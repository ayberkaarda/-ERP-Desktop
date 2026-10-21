<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Policies;

/**
 * Items; variants, barcodes and alternate units are authorized as view/update of their item.
 */
final class ItemPolicy extends CatalogPolicy
{
    protected function viewPermissions(): array
    {
        return ['items.view'];
    }

    protected function createPermissions(): array
    {
        return ['items.create'];
    }

    protected function updatePermissions(): array
    {
        return ['items.update'];
    }

    protected function deletePermissions(): array
    {
        return ['items.delete'];
    }
}
