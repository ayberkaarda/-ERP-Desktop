<?php

declare(strict_types=1);

namespace App\Modules\Parties\Enums;

enum PartyRole: string
{
    case Customer = 'customer';
    case Supplier = 'supplier';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $case): string => $case->value, self::cases());
    }

    /**
     * Distinct, in declaration order, so stored arrays compare equal regardless of input order.
     *
     * @param  array<mixed>  $values
     * @return list<string>
     */
    public static function normalize(array $values): array
    {
        return array_values(array_filter(self::values(), static fn (string $role): bool => in_array($role, $values, true)));
    }
}
