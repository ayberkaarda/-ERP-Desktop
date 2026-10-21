<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services\Composer;

final readonly class ComposeOptions
{
    public function __construct(
        /** The actor holds sales.price_override. */
        public bool $canOverridePrice = false,
        /** false (preview): an unauthorized override is reported as a warning instead of failing. */
        public bool $strict = true,
        /** Stock lines need a warehouse (deliveries). */
        public bool $requireWarehouse = false,
    ) {}
}
