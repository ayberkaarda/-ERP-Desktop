<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Purchasing\Enums\OrderStatus;
use App\Modules\Purchasing\Models\PurchaseOrder;
use App\Modules\Purchasing\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Services\Machines\OrderMachine;
use Brick\Math\BigDecimal;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Keeps received/invoiced quantities of order lines and the derived order status in step. Callers
 * hold the order row lock. Service lines are never received, so an order of services only stays
 * approved/sent until it is invoiced.
 */
final class OrderProgress
{
    public function __construct(private readonly OrderMachine $machine) {}

    public function addReceived(PurchaseOrderLine $line, BigDecimal $quantity): void
    {
        $value = $line->received_quantity->plus($quantity);
        $line->setAttribute('received_quantity', $value->isNegative() ? '0' : (string) $value);
        $line->save();
    }

    public function addInvoiced(PurchaseOrderLine $line, BigDecimal $quantity): void
    {
        $value = $line->invoiced_quantity->plus($quantity);
        $line->setAttribute('invoiced_quantity', $value->isNegative() ? '0' : (string) $value);
        $line->save();
    }

    public function refresh(PurchaseOrder $order, ?Authenticatable $actor = null): void
    {
        if (! in_array($order->status, [...OrderStatus::open(), OrderStatus::Invoiced], true)) {
            return;
        }

        $target = $this->status($order, array_values($order->lines()->get()->all()));

        if ($target !== $order->status) {
            $this->machine->transition($order, $target, $actor);
        }
    }

    /**
     * @param  list<PurchaseOrderLine>  $lines
     */
    public function status(PurchaseOrder $order, array $lines): OrderStatus
    {
        $allInvoiced = $lines !== [];
        $anyInvoiced = false;
        $stock = 0;
        $allReceived = true;
        $anyReceived = false;

        foreach ($lines as $line) {
            $allInvoiced = $allInvoiced && $line->invoiced_quantity->isGreaterThanOrEqualTo($line->quantity);
            $anyInvoiced = $anyInvoiced || $line->invoiced_quantity->isPositive();
            $anyReceived = $anyReceived || $line->received_quantity->isPositive();

            if ($line->isStock()) {
                $stock++;
                $allReceived = $allReceived && $line->received_quantity->isGreaterThanOrEqualTo($line->quantity);
            }
        }

        return match (true) {
            $allInvoiced => OrderStatus::Invoiced,
            $anyInvoiced => OrderStatus::PartiallyInvoiced,
            $stock > 0 && $allReceived => OrderStatus::Received,
            $anyReceived => OrderStatus::PartiallyReceived,
            $order->sent_at !== null => OrderStatus::Sent,
            default => OrderStatus::Approved,
        };
    }
}
