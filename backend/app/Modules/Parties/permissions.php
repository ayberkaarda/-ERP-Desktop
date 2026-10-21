<?php

declare(strict_types=1);

/**
 * Permission declaration of this module, aggregated by Identity's PermissionCatalog and DefaultRoles.
 * Sub-resources (addresses, contacts, bank accounts) reuse parties.view / parties.update.
 */

return [
    'group' => 'parties',
    'permissions' => [
        'parties.view' => ['roles' => ['Admin', 'Accountant', 'Sales', 'Purchasing', 'Warehouse', 'Viewer']],
        'parties.create' => ['roles' => ['Admin', 'Accountant', 'Sales', 'Purchasing']],
        'parties.update' => ['roles' => ['Admin', 'Accountant', 'Sales', 'Purchasing']],
        'parties.delete' => ['roles' => ['Admin']],
        'parties.export' => ['roles' => ['Admin', 'Accountant']],
    ],
];
