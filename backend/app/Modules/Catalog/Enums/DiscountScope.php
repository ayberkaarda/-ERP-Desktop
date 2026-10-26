<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Enums;

enum DiscountScope: string
{
    case Item = 'item';
    case Category = 'category';
    case Party = 'party';
    case All = 'all';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }

    /** Tie-breaker between rules of equal priority: the narrower scope wins. */
    public function specificity(): int
    {
        return match ($this) {
            self::Item => 3,
            self::Category => 2,
            self::Party => 1,
            self::All => 0,
        };
    }

    public function needsScopeRef(): bool
    {
        return $this === self::Item || $this === self::Category;
    }
}
