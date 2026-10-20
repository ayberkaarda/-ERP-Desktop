<?php

declare(strict_types=1);

return [
    /*
     * Tokens: {series}, {year}, {yy}, {seq:N}. The default matches the e-Invoice
     * number shape (ABC2026000000001). A sequence row may override it per series.
     */
    'format' => '{series}{year}{seq:9}',

    // doc_type => format
    'formats' => [],
];
