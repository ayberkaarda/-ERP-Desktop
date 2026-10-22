<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

enum InvoiceStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Booked = 'booked';
    case PartiallyPaid = 'partially_paid';
    case Paid = 'paid';
    case Cancelled = 'cancelled';
    case Reversed = 'reversed';

    /**
     * Booked and not settled: open payables.
     *
     * @return list<string>
     */
    public static function open(): array
    {
        return [self::Booked->value, self::PartiallyPaid->value];
    }

    /**
     * Booked into the ledger and not reversed.
     *
     * @return list<string>
     */
    public static function booked(): array
    {
        return [self::Booked->value, self::PartiallyPaid->value, self::Paid->value];
    }

    /**
     * States whose lines hold quantities of their source documents (drafts included).
     *
     * @return list<string>
     */
    public static function holding(): array
    {
        return [self::Draft->value, self::PendingApproval->value, ...self::booked()];
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
