<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

/**
 * Three-way match result of an invoice line; the invoice carries the worst of its lines
 * (qty_variance, then price_variance, then unmatched, then matched).
 */
enum MatchStatus: string
{
    case Matched = 'matched';
    case QtyVariance = 'qty_variance';
    case PriceVariance = 'price_variance';
    case Unmatched = 'unmatched';

    public function weight(): int
    {
        return match ($this) {
            self::Matched => 0,
            self::Unmatched => 1,
            self::PriceVariance => 2,
            self::QtyVariance => 3,
        };
    }

    public function isVariance(): bool
    {
        return $this === self::QtyVariance || $this === self::PriceVariance;
    }
}
