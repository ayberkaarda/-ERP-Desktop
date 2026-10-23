<?php

declare(strict_types=1);

return ['group' => 'edocuments', 'permissions' => [
    'edocuments.view' => ['roles' => ['Accountant', 'Sales', 'Purchasing']],
    'edocuments.create' => ['roles' => ['Accountant', 'Sales']],
    'edocuments.validate' => ['roles' => ['Accountant', 'Sales']],
    'edocuments.send' => ['roles' => ['Accountant', 'Sales']],
    'edocuments.respond' => ['roles' => ['Accountant', 'Purchasing']],
    'edocuments.import' => ['roles' => ['Accountant', 'Purchasing']],
    'edocuments.manage' => [],
]];
