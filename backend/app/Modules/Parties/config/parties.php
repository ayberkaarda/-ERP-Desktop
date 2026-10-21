<?php

declare(strict_types=1);

return [
    /*
     * Accept currency codes, payment term ids and price list ids without an existence check while
     * the providing modules (Reference, Catalog) are not installed. Off by default: an unverifiable
     * reference is a validation error.
     */
    'allow_unverified_references' => false,

    // Exports above this many rows are refused instead of truncated.
    'export_max_rows' => 50000,
];
