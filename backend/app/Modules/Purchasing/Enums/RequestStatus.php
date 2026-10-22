<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

enum RequestStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Approved = 'approved';
    case Rejected = 'rejected';
    case PartiallyOrdered = 'partially_ordered';
    case Ordered = 'ordered';
    case Cancelled = 'cancelled';

    /**
     * Approved and not fully ordered: may be converted to an RFQ or orders.
     *
     * @return list<self>
     */
    public static function open(): array
    {
        return [self::Approved, self::PartiallyOrdered];
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
