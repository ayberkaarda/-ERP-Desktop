<?php

declare(strict_types=1);

// Module defaults merged under `accounting`; a deployment may override them in config/accounting.php.
return [
    // TDHP template consumed by the chart seeder (array of {code, name, parent_code, type, normal_balance, ...}).
    'chart_path' => dirname(__DIR__).'/Database/data/tdhp.json',

    // Seed chart, default determination rules and the current fiscal year for every new company.
    'bootstrap_on_company_created' => true,

    'export_max_rows' => 50000,

    'import_max_rows' => 5000,
];
