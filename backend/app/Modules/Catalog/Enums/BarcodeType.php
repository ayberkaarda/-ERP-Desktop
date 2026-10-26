<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Enums;

use App\Modules\Catalog\Barcodes\BarcodeValidator;
use App\Modules\Catalog\Barcodes\Ean13Validator;
use App\Modules\Catalog\Barcodes\Ean8Validator;
use App\Modules\Catalog\Barcodes\UpcAValidator;

enum BarcodeType: string
{
    case Ean13 = 'ean13';
    case Ean8 = 'ean8';
    case UpcA = 'upca';
    case Code128 = 'code128';
    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }

    /** Check-digit validator for declared GTIN types; free-form types have none. */
    public function validator(): ?BarcodeValidator
    {
        return match ($this) {
            self::Ean13 => new Ean13Validator,
            self::Ean8 => new Ean8Validator,
            self::UpcA => new UpcAValidator,
            self::Code128, self::Other => null,
        };
    }
}
