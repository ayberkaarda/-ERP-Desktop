<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services\Composer;

final readonly class ComposeOptions
{
    public function __construct(
        /** The actor holds purchasing.price_override (a source-linked line priced differently from its source). */
        public bool $canOverridePrice = false,
        /** false (preview): an unauthorized override is reported as a warning instead of failing. */
        public bool $strict = true,
        /** Stock lines need a warehouse (receipts). */
        public bool $requireWarehouse = false,
    ) {}
}
