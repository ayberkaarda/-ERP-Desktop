<?php

declare(strict_types=1);

/**
 * Permission declaration of this module, aggregated by Identity's PermissionCatalog and DefaultRoles.
 * Format: see app/Modules/Catalog/permissions.php. Admin always receives the whole catalog.
 *
 * inventory.reports.view is declared here for the stock reports (/inventory-reports/*).
 * inventory.documents.issue_expired lets a poster issue from expired lots (allow_expired flag).
 */

return [
    'group' => 'inventory',
    'permissions' => [
        'inventory.warehouses.view' => ['roles' => ['Warehouse', 'Accountant', 'Sales', 'Purchasing', 'Viewer']],
        'inventory.warehouses.manage' => ['roles' => ['Warehouse']],
        'inventory.documents.view' => ['roles' => ['Warehouse', 'Accountant', 'Purchasing', 'Viewer']],
        'inventory.documents.create' => ['roles' => ['Warehouse']],
        'inventory.documents.post' => ['roles' => ['Warehouse']],
        'inventory.documents.reverse' => ['roles' => ['Accountant']],
        'inventory.documents.issue_expired' => [],
        'inventory.stock.view' => ['roles' => ['Warehouse', 'Accountant', 'Sales', 'Purchasing', 'Viewer']],
        'inventory.reservations.manage' => ['roles' => ['Warehouse', 'Sales']],
        'inventory.reports.view' => ['roles' => ['Warehouse', 'Accountant', 'Viewer']],
    ],
];
