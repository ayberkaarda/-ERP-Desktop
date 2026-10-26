<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Barcodes;

/** EAN-13: 13 digits, the last one is the GS1 check digit. */
final class Ean13Validator extends GtinValidator
{
    public function length(): int
    {
        return 13;
    }
}
