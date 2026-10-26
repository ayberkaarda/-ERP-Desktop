<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Barcodes;

/** UPC-A (GTIN-12): 12 digits, the last one is the GS1 check digit. */
final class UpcAValidator extends GtinValidator
{
    public function length(): int
    {
        return 12;
    }
}
