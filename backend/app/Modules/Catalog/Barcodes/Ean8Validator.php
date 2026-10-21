<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Barcodes;

/** EAN-8: 8 digits, the last one is the GS1 check digit. */
final class Ean8Validator extends GtinValidator
{
    public function length(): int
    {
        return 8;
    }
}
