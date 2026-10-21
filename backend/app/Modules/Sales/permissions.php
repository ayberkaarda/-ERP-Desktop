<?php

declare(strict_types=1);

/**
 * Permission declaration of this module, aggregated by Identity's PermissionCatalog and DefaultRoles.
 * Format: see app/Modules/Catalog/permissions.php. Admin always receives the whole catalog.
 *
 * Quote actions (send, accept, reject, revise, cancel, convert) use sales.quotes.update; convert also
 * needs sales.orders.create. Order confirm/revise/close use sales.orders.approve. Creating a
 * delivery, invoice or return from a source needs the create permission of the new document.
 * sales.price_override allows explicit prices that differ from the resolved price;
 * sales.credit_override allows confirming/issuing over the credit limit with a reason.
 * sales.reports.view is declared here for the sales reports (/sales-reports/*).
 */

return [
    'group' => 'sales',
    'permissions' => [
        'sales.quotes.view' => ['roles' => ['Sales', 'Accountant', 'Viewer']],
        'sales.quotes.create' => ['roles' => ['Sales']],
        'sales.quotes.update' => ['roles' => ['Sales']],
        'sales.quotes.delete' => ['roles' => ['Sales']],
        'sales.orders.view' => ['roles' => ['Sales', 'Accountant', 'Warehouse', 'Viewer']],
        'sales.orders.create' => ['roles' => ['Sales']],
        'sales.orders.update' => ['roles' => ['Sales']],
        'sales.orders.delete' => ['roles' => ['Sales']],
        'sales.orders.approve' => ['roles' => ['Sales']],
        'sales.deliveries.view' => ['roles' => ['Sales', 'Accountant', 'Warehouse', 'Viewer']],
        'sales.deliveries.create' => ['roles' => ['Warehouse', 'Sales']],
        'sales.deliveries.update' => ['roles' => ['Warehouse', 'Sales']],
        'sales.deliveries.delete' => ['roles' => ['Warehouse', 'Sales']],
        'sales.deliveries.post' => ['roles' => ['Warehouse']],
        'sales.deliveries.reverse' => ['roles' => ['Accountant']],
        'sales.invoices.view' => ['roles' => ['Sales', 'Accountant', 'Viewer']],
        'sales.invoices.create' => ['roles' => ['Sales', 'Accountant']],
        'sales.invoices.update' => ['roles' => ['Sales', 'Accountant']],
        'sales.invoices.delete' => ['roles' => ['Sales', 'Accountant']],
        'sales.invoices.issue' => ['roles' => ['Accountant']],
        'sales.invoices.reverse' => ['roles' => ['Accountant']],
        'sales.returns.view' => ['roles' => ['Sales', 'Accountant', 'Warehouse', 'Viewer']],
        'sales.returns.create' => ['roles' => ['Sales']],
        'sales.returns.update' => ['roles' => ['Sales']],
        'sales.returns.delete' => ['roles' => ['Sales']],
        'sales.returns.approve' => ['roles' => ['Sales', 'Accountant']],
        'sales.returns.receive' => ['roles' => ['Warehouse']],
        'sales.returns.credit' => ['roles' => ['Accountant']],
        'sales.price_override' => [],
        'sales.credit_override' => [],
        'sales.reports.view' => ['roles' => ['Sales', 'Accountant', 'Viewer']],
    ],
];
