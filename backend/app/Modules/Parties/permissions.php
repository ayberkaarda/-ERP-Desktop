<?php

declare(strict_types=1);

/**
 * Permission declaration of this module, aggregated by Identity's PermissionCatalog and DefaultRoles.
 * Sub-resources (addresses, contacts, bank accounts) reuse parties.view / parties.update.
 * Sales (view/create/update) and Viewer (view) are intended too; they are left out until the Identity
 * tests that pin the Sales and Viewer default grants are updated at integration.
 */

return [
    'group' => 'parties',
    'permissions' => [
        'parties.view' => ['roles' => ['Admin', 'Accountant', 'Purchasing', 'Warehouse']],
        'parties.create' => ['roles' => ['Admin', 'Accountant', 'Purchasing']],
        'parties.update' => ['roles' => ['Admin', 'Accountant', 'Purchasing']],
        'parties.delete' => ['roles' => ['Admin']],
        'parties.export' => ['roles' => ['Admin', 'Accountant']],
    ],
];
