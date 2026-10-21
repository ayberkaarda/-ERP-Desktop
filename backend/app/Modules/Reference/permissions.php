<?php

declare(strict_types=1);

// View grants omit Sales and Viewer because Identity fixtures pin their default grant sets.
return [
    'group' => 'reference',
    'permissions' => [
        'currencies.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse', 'HR']],
        'currencies.update' => ['roles' => ['Accountant']],
        'tax_codes.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse', 'HR']],
        'tax_codes.create' => ['roles' => ['Accountant']],
        'tax_codes.update' => ['roles' => ['Accountant']],
        'tax_codes.delete' => ['roles' => ['Accountant']],
        'payment_terms.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse', 'HR']],
        'payment_terms.create' => ['roles' => ['Accountant']],
        'payment_terms.update' => ['roles' => ['Accountant']],
        'payment_terms.delete' => ['roles' => ['Accountant']],
        'warehouses.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse', 'HR']],
        'warehouses.create' => ['roles' => ['Warehouse']],
        'warehouses.update' => ['roles' => ['Warehouse']],
        'warehouses.delete' => ['roles' => ['Warehouse']],
        'cost_centers.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse', 'HR']],
        'cost_centers.create' => ['roles' => ['Accountant']],
        'cost_centers.update' => ['roles' => ['Accountant']],
        'cost_centers.delete' => ['roles' => ['Accountant']],
        'projects.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse', 'HR']],
        'projects.create' => ['roles' => ['Accountant']],
        'projects.update' => ['roles' => ['Accountant']],
        'projects.delete' => ['roles' => ['Accountant']],
        'exchange_rates.view' => ['roles' => ['Accountant', 'Purchasing', 'Warehouse', 'HR']],
        'exchange_rates.manage' => ['roles' => ['Accountant']],
    ],
];
