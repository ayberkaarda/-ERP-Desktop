<?php

declare(strict_types=1);

return [
    // Row cap of list exports (CSV/XLSX); larger requests are refused with 422.
    'export_max_rows' => 50000,
];
