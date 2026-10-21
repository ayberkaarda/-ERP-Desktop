<?php

declare(strict_types=1);

namespace App\Modules\Sales\Enums;

enum OrderStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Confirmed = 'confirmed';
    case PartiallyDelivered = 'partially_delivered';
    case Delivered = 'delivered';
    case PartiallyInvoiced = 'partially_invoiced';
    case Invoiced = 'invoiced';
    case Closed = 'closed';
    case Cancelled = 'cancelled';

    /**
     * Confirmed and not finished: counts towards customer exposure and may be delivered or invoiced.
     *
     * @return list<self>
     */
    public static function open(): array
    {
        return [self::Confirmed, self::PartiallyDelivered, self::Delivered, self::PartiallyInvoiced];
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
