<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesOrderLine;
use App\Modules\Sales\Services\Machines\OrderMachine;
use Brick\Math\BigDecimal;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Keeps delivered/invoiced quantities of order lines and the derived order status in step.
 * Callers hold the order row lock. Service lines are never delivered, so an order of services only
 * stays confirmed until it is invoiced.
 */
final class OrderProgress
{
    public function __construct(private readonly OrderMachine $machine) {}

    public function addDelivered(SalesOrderLine $line, BigDecimal $quantity): void
    {
        $line->delivered_quantity = $line->delivered_quantity->plus($quantity);
        $line->save();
    }

    public function addInvoiced(SalesOrderLine $line, BigDecimal $quantity): void
    {
        $value = $line->invoiced_quantity->plus($quantity);
        $line->invoiced_quantity = $value->isNegative() ? BigDecimal::zero() : $value;
        $line->save();
    }

    public function refresh(SalesOrder $order, ?Authenticatable $actor = null): void
    {
        if (! in_array($order->status, [...OrderStatus::open(), OrderStatus::Invoiced], true)) {
            return;
        }

        $target = $this->status(array_values($order->lines()->get()->all()));

        if ($target !== $order->status) {
            $this->machine->transition($order, $target, $actor);
        }
    }

    /**
     * @param  list<SalesOrderLine>  $lines
     */
    public function status(array $lines): OrderStatus
    {
        $allInvoiced = $lines !== [];
        $anyInvoiced = false;
        $stock = 0;
        $allDelivered = true;
        $anyDelivered = false;

        foreach ($lines as $line) {
            $allInvoiced = $allInvoiced && $line->invoiced_quantity->isGreaterThanOrEqualTo($line->quantity);
            $anyInvoiced = $anyInvoiced || $line->invoiced_quantity->isPositive();
            $anyDelivered = $anyDelivered || $line->delivered_quantity->isPositive();

            if ($line->isStock()) {
                $stock++;
                $allDelivered = $allDelivered && $line->delivered_quantity->isGreaterThanOrEqualTo($line->quantity);
            }
        }

        return match (true) {
            $allInvoiced => OrderStatus::Invoiced,
            $anyInvoiced => OrderStatus::PartiallyInvoiced,
            $stock > 0 && $allDelivered => OrderStatus::Delivered,
            $anyDelivered => OrderStatus::PartiallyDelivered,
            default => OrderStatus::Confirmed,
        };
    }
}
