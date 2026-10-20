<?php

declare(strict_types=1);

return [
    // Off by default; must be opted into per environment.
    'enabled' => (bool) env('ASSISTANT_ENABLED', false),
];
