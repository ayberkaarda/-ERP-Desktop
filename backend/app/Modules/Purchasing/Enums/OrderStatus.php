<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Enums;

enum OrderStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Approved = 'approved';
    case Sent = 'sent';
    case PartiallyReceived = 'partially_received';
    case Received = 'received';
    case PartiallyInvoiced = 'partially_invoiced';
    case Invoiced = 'invoiced';
    case Closed = 'closed';
    case Cancelled = 'cancelled';

    /**
     * Approved and not finished: counts towards supplier exposure and may be received or invoiced.
     *
     * @return list<self>
     */
    public static function open(): array
    {
        return [self::Approved, self::Sent, self::PartiallyReceived, self::Received, self::PartiallyInvoiced];
    }

    /** @return list<string> */
    public static function openValues(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::open());
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $c): string => $c->value, self::cases());
    }
}
