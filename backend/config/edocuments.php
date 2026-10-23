<?php

declare(strict_types=1);

return [
    'driver' => env('EDOCUMENTS_DRIVER', 'sandbox'),
    'java_binary' => env('EDOCUMENTS_JAVA_BINARY', 'java'),
    'max_xml_bytes' => 2097152,
    'operation_lease_seconds' => 180,
];
