<?php

declare(strict_types=1);

namespace App\Modules\EDocuments\Enums;

enum DocumentKind: string
{
    case Invoice = 'e_invoice';
    case Archive = 'e_archive';
    case Despatch = 'e_despatch';

    /** @return list<string> */
    public function profiles(): array
    {
        return match ($this) {
            self::Invoice => ['TEMELFATURA', 'TICARIFATURA', 'IHRACAT', 'KAMU'],
            self::Archive => ['EARSIVFATURA'],
            self::Despatch => ['TEMELIRSALIYE'],
        };
    }

    public function sourceType(): string
    {
        return $this === self::Despatch ? 'delivery' : 'invoice';
    }

    public function permission(): string
    {
        return $this === self::Despatch ? 'sales.deliveries.view' : 'sales.invoices.view';
    }
}
