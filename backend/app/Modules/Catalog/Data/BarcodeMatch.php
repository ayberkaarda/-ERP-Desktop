<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Data;

final readonly class BarcodeMatch
{
    public function __construct(
        public ItemData $item,
        public ?string $variantId,
        public string $unitId,
        public string $barcode,
        public string $type,
    ) {}
}
