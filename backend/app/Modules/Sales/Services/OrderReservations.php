<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Inventory\Contracts\Reservations;
use App\Modules\Inventory\Contracts\WarehouseLookup;
use App\Modules\Inventory\Data\ReservationRequest;
use App\Modules\Inventory\Enums\ReservationPolicy;
use App\Modules\Sales\Models\SalesOrder;
use App\Modules\Sales\Models\SalesOrderLine;
use App\Modules\Sales\Support\Messages;
use App\Modules\Sales\Support\Sales;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Validation\ValidationException;

/**
 * Stock held for confirmed orders through Inventory's Reservations (the warehouse policy decides
 * hard/soft; warehouses without reservations are skipped). One reservation per stock line, source
 * sales_order_line; delivery posting consumes it, cancel/close/revise release what is left.
 */
final class OrderReservations
{
    public const string SOURCE = 'sales_order_line';

    public function __construct(
        private readonly Reservations $reservations,
        private readonly WarehouseLookup $warehouses,
    ) {}

    /**
     * Reserves the undelivered base quantity of each stock line; returns shortage warnings (soft policy).
     *
     * @return list<array<string, mixed>>
     */
    public function reserve(SalesOrder $order, ?string $actor): array
    {
        $warnings = [];

        foreach ($order->lines()->get() as $line) {
            /** @var SalesOrderLine $line */
            $warehouseId = $line->warehouse_id ?? $order->warehouse_id;

            if (! $line->isStock() || $warehouseId === null || $line->reservation_id !== null) {
                continue;
            }

            $warehouse = $this->warehouses->find($warehouseId);

            if ($warehouse === null || $warehouse->reservationPolicy === ReservationPolicy::None) {
                continue;
            }

            $open = $line->base_quantity->minus($this->deliveredBase($line));

            if (! $open->isPositive()) {
                continue;
            }

            $data = $this->reservations->reserve(new ReservationRequest(
                $order->company_id, $line->item_id, $warehouseId, Sales::qty($open), null, self::SOURCE, $line->id, null, $actor,
            ));
            $line->reservation_id = $data->id;
            $line->save();

            if (Sales::dec($data->shortage)->isPositive()) {
                $warnings[] = [
                    'code' => 'sales.reservation_shortage', 'line' => $line->line_no, 'shortage' => $data->shortage,
                    'message' => Messages::get('reservation_shortage', ['line' => $line->line_no, 'shortage' => $data->shortage]),
                ];
            }
        }

        return $warnings;
    }

    /** Releases every still active reservation of the order. */
    public function release(SalesOrder $order): void
    {
        foreach ($order->lines()->whereNotNull('reservation_id')->get() as $line) {
            /** @var SalesOrderLine $line */
            $this->releaseLine($order->company_id, $line);
        }
    }

    public function releaseLine(string $companyId, SalesOrderLine $line): void
    {
        if ($line->reservation_id === null) {
            return;
        }

        try {
            $this->reservations->release($companyId, $line->reservation_id);
        } catch (ValidationException) {
            // Consumed by deliveries or expired meanwhile: nothing is held any more.
        }

        $line->reservation_id = null;
        $line->save();
    }

    private function deliveredBase(SalesOrderLine $line): BigDecimal
    {
        if ($line->delivered_quantity->isZero()) {
            return $line->delivered_quantity;
        }

        return $line->base_quantity->multipliedBy($line->delivered_quantity)->dividedBy($line->quantity, 6, RoundingMode::HalfUp);
    }
}
