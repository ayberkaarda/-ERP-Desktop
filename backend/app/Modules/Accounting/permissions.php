<?php

declare(strict_types=1);

/**
 * Permission declaration of this module, aggregated by Identity's PermissionCatalog and DefaultRoles.
 * Format: see app/Modules/Catalog/permissions.php. Admin always receives the whole catalog.
 *
 * accounting.reports.view is declared here for the reports of this module (Reports/ subfolder).
 */

return [
    'group' => 'accounting',
    'permissions' => [
        'accounting.accounts.view' => ['roles' => ['Accountant', 'Sales', 'Purchasing', 'Viewer']],
        'accounting.accounts.manage' => ['roles' => ['Accountant']],
        'accounting.periods.view' => ['roles' => ['Accountant', 'Viewer']],
        'accounting.periods.manage' => ['roles' => ['Accountant']],
        'accounting.periods.close' => ['roles' => ['Accountant']],
        'accounting.periods.reopen' => [],
        'accounting.year.close' => [],
        'accounting.entries.view' => ['roles' => ['Accountant', 'Viewer']],
        'accounting.entries.create' => ['roles' => ['Accountant']],
        'accounting.entries.post' => ['roles' => ['Accountant']],
        'accounting.entries.post_soft_closed' => [],
        'accounting.entries.reverse' => ['roles' => ['Accountant']],
        'accounting.determination.manage' => ['roles' => ['Accountant']],
        'accounting.revaluation.run' => ['roles' => ['Accountant']],
        'accounting.reports.view' => ['roles' => ['Accountant', 'Viewer']],
    ],
];
