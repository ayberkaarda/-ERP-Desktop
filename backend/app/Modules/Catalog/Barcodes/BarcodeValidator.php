<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Barcodes;

interface BarcodeValidator
{
    public function isValid(string $barcode): bool;
}
