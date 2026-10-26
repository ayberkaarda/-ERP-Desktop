<?php

declare(strict_types=1);

/**
 * Permission declaration of this module, aggregated by Identity's PermissionCatalog and DefaultRoles.
 * Format: see app/Modules/Catalog/permissions.php. Admin always receives the whole catalog.
 *
 * Request submit/cancel use purchasing.requests.update (the approval itself runs through the
 * workflow); RFQ send/quote entry/cancel use purchasing.rfqs.update, award needs purchasing.rfqs.award
 * and purchasing.orders.create. Order submit/revise/close use purchasing.orders.approve; send and
 * cancel are updates. Creating a document from a source needs the create permission of the new
 * document and view on the source. purchasing.match_override books over a three-way match
 * variance in block mode (with a reason); purchasing.price_override prices a line taken from an
 * order or receipt differently from its source. purchasing.reports.view is declared here for the
 * purchasing reports (/purchase-reports/*).
 */

return [
    'group' => 'purchasing',
    'permissions' => [
        'purchasing.requests.view' => ['roles' => ['Purchasing', 'Accountant', 'Warehouse', 'Viewer']],
        'purchasing.requests.create' => ['roles' => ['Purchasing', 'Warehouse']],
        'purchasing.requests.update' => ['roles' => ['Purchasing', 'Warehouse']],
        'purchasing.requests.delete' => ['roles' => ['Purchasing', 'Warehouse']],
        'purchasing.rfqs.view' => ['roles' => ['Purchasing', 'Accountant', 'Viewer']],
        'purchasing.rfqs.create' => ['roles' => ['Purchasing']],
        'purchasing.rfqs.update' => ['roles' => ['Purchasing']],
        'purchasing.rfqs.delete' => ['roles' => ['Purchasing']],
        'purchasing.rfqs.award' => ['roles' => ['Purchasing']],
        'purchasing.orders.view' => ['roles' => ['Purchasing', 'Accountant', 'Warehouse', 'Viewer']],
        'purchasing.orders.create' => ['roles' => ['Purchasing']],
        'purchasing.orders.update' => ['roles' => ['Purchasing']],
        'purchasing.orders.delete' => ['roles' => ['Purchasing']],
        'purchasing.orders.approve' => ['roles' => ['Purchasing']],
        'purchasing.receipts.view' => ['roles' => ['Purchasing', 'Accountant', 'Warehouse', 'Viewer']],
        'purchasing.receipts.create' => ['roles' => ['Warehouse', 'Purchasing']],
        'purchasing.receipts.update' => ['roles' => ['Warehouse', 'Purchasing']],
        'purchasing.receipts.delete' => ['roles' => ['Warehouse', 'Purchasing']],
        'purchasing.receipts.post' => ['roles' => ['Warehouse']],
        'purchasing.receipts.reverse' => ['roles' => ['Accountant']],
        'purchasing.invoices.view' => ['roles' => ['Purchasing', 'Accountant', 'Viewer']],
        'purchasing.invoices.create' => ['roles' => ['Purchasing', 'Accountant']],
        'purchasing.invoices.update' => ['roles' => ['Purchasing', 'Accountant']],
        'purchasing.invoices.delete' => ['roles' => ['Purchasing', 'Accountant']],
        'purchasing.invoices.book' => ['roles' => ['Accountant']],
        'purchasing.invoices.reverse' => ['roles' => ['Accountant']],
        'purchasing.returns.view' => ['roles' => ['Purchasing', 'Accountant', 'Warehouse', 'Viewer']],
        'purchasing.returns.create' => ['roles' => ['Purchasing']],
        'purchasing.returns.update' => ['roles' => ['Purchasing']],
        'purchasing.returns.delete' => ['roles' => ['Purchasing']],
        'purchasing.returns.approve' => ['roles' => ['Purchasing', 'Accountant']],
        'purchasing.returns.ship' => ['roles' => ['Warehouse']],
        'purchasing.returns.debit' => ['roles' => ['Accountant']],
        'purchasing.match_override' => [],
        'purchasing.price_override' => [],
        'purchasing.reports.view' => ['roles' => ['Purchasing', 'Accountant', 'Viewer']],
    ],
];
