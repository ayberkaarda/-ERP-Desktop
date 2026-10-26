<?php

declare(strict_types=1);

// Module defaults merged under `inventory`; a deployment may override them in config/inventory.php.
return [
    // Seed the inventory determination rules for every new company (after Accounting's chart).
    'seed_rules_on_company_created' => true,

    'export_max_rows' => 50000,

    'import_max_rows' => 5000,
];
