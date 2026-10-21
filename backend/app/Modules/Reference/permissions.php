<?php

declare(strict_types=1);

return [
    'group' => 'reference',
    'permissions' => [
        'currencies.view' => ['roles' => ['*']],
        'currencies.update' => ['roles' => ['Accountant']],
        'tax_codes.view' => ['roles' => ['*']],
        'tax_codes.create' => ['roles' => ['Accountant']],
        'tax_codes.update' => ['roles' => ['Accountant']],
        'tax_codes.delete' => ['roles' => ['Accountant']],
        'payment_terms.view' => ['roles' => ['*']],
        'payment_terms.create' => ['roles' => ['Accountant']],
        'payment_terms.update' => ['roles' => ['Accountant']],
        'payment_terms.delete' => ['roles' => ['Accountant']],
        'warehouses.view' => ['roles' => ['*']],
        'warehouses.create' => ['roles' => ['Warehouse']],
        'warehouses.update' => ['roles' => ['Warehouse']],
        'warehouses.delete' => ['roles' => ['Warehouse']],
        'cost_centers.view' => ['roles' => ['*']],
        'cost_centers.create' => ['roles' => ['Accountant']],
        'cost_centers.update' => ['roles' => ['Accountant']],
        'cost_centers.delete' => ['roles' => ['Accountant']],
        'projects.view' => ['roles' => ['*']],
        'projects.create' => ['roles' => ['Accountant']],
        'projects.update' => ['roles' => ['Accountant']],
        'projects.delete' => ['roles' => ['Accountant']],
        'exchange_rates.view' => ['roles' => ['*']],
        'exchange_rates.manage' => ['roles' => ['Accountant']],
    ],
];
