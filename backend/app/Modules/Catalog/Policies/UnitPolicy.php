<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Policies;

/**
 * Units and unit conversions: readable by item viewers, managed with units.manage.
 */
final class UnitPolicy extends CatalogPolicy
{
    protected function viewPermissions(): array
    {
        return ['units.manage', 'items.view'];
    }

    protected function createPermissions(): array
    {
        return ['units.manage'];
    }
}
