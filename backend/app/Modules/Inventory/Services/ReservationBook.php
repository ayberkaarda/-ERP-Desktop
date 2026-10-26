<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Services;

use App\Core\Company\CompanyContext;
use App\Modules\Catalog\Contracts\ItemLookup;
use App\Modules\Inventory\Contracts\Reservations;
use App\Modules\Inventory\Data\ReservationData;
use App\Modules\Inventory\Data\ReservationRequest;
use App\Modules\Inventory\Enums\ReservationPolicy;
use App\Modules\Inventory\Enums\ReservationStatus;
use App\Modules\Inventory\Enums\ValuationMethod;
use App\Modules\Inventory\Models\StockReservation;
use App\Modules\Inventory\Services\Costing\CostBook;
use App\Modules\Inventory\Services\Ledger\Balances;
use App\Modules\Inventory\Support\Messages;
use App\Modules\Inventory\Support\Stock;
use Brick\Math\BigDecimal;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Reservations change stock_balances.reserved under the same pair lock as postings, so a
 * reservation and an issue (or two reservations) of the last units are serialized.
 */
final class ReservationBook implements Reservations
{
    public function __construct(
        private readonly CompanyContext $company,
        private readonly ItemLookup $items,
        private readonly WarehouseDirectory $warehouses,
    ) {}

    public function reserve(ReservationRequest $request): ReservationData
    {
        return $this->company->runAs($request->companyId, fn (): ReservationData => Stock::transaction(function () use ($request): ReservationData {
            $qty = Stock::dec($request->quantity);
            $item = $this->items->find($request->itemId);
            $warehouse = $this->warehouses->find($request->warehouseId);

            if ($item === null || $item->type !== 'stock') {
                Messages::fail('item_id', 'item_missing');
            }

            if ($warehouse === null || ! $warehouse->isActive) {
                Messages::fail('warehouse_id', 'warehouse_unavailable');
            }

            if ($warehouse->reservationPolicy === ReservationPolicy::None) {
                Messages::fail('warehouse_id', 'reservations_disabled', ['warehouse' => $warehouse->code]);
            }

            if (! $qty->isPositive()) {
                Messages::fail('quantity', 'quantity_positive');
            }

            if ($request->lotId !== null && ! DB::table('stock_lots')->where('id', $request->lotId)->where('company_id', $request->companyId)->where('item_id', $item->id)->exists()) {
                Messages::fail('lot_id', 'lot_unknown', ['lot' => $request->lotId]);
            }

            if ($request->expiresAt !== null && $request->expiresAt <= now()) {
                Messages::fail('expires_at', 'reservation_expiry_past');
            }

            $balances = $this->lockPair($request->companyId, $item->id, $warehouse->id);

            if ($request->sourceType !== null && $request->sourceId !== null) {
                $existing = StockReservation::query()->where('source_type', $request->sourceType)->where('source_id', $request->sourceId)
                    ->where('item_id', $item->id)->where('warehouse_id', $warehouse->id)
                    ->where(fn ($q) => $request->lotId === null ? $q->whereNull('lot_id') : $q->where('lot_id', $request->lotId))
                    ->where('status', ReservationStatus::Active->value)->first();

                if ($existing !== null) {
                    return ReservationData::of($existing, replayed: true);
                }
            }

            // Availability of the warehouse and, for a lot reservation, of the lot: lot-less holds
            // count against every lot, and lot holds against the warehouse total.
            [$onHand, $reserved] = $balances->totals($item->id, $warehouse->id);
            $available = $onHand->minus($reserved);

            if ($request->lotId !== null) {
                [$lotOnHand, $lotReserved] = $balances->totals($item->id, $warehouse->id, $request->lotId);
                $lotAvailable = $lotOnHand->minus($lotReserved);
                $available = $lotAvailable->isLessThan($available) ? $lotAvailable : $available;
            }

            $shortage = $qty->isGreaterThan($available) ? $qty->minus($available->isNegative() ? BigDecimal::zero() : $available) : BigDecimal::zero();

            if ($shortage->isPositive() && $warehouse->reservationPolicy === ReservationPolicy::Hard) {
                Messages::fail('quantity', 'reservation_exceeds_available', ['available' => Stock::qty($available), 'item' => $item->code]);
            }

            $reservation = new StockReservation([
                'item_id' => $item->id, 'warehouse_id' => $warehouse->id, 'lot_id' => $request->lotId, 'quantity' => Stock::qty($qty),
                'source_type' => $request->sourceType, 'source_id' => $request->sourceId, 'expires_at' => $request->expiresAt, 'notes' => $request->notes,
            ]);
            $reservation->created_by = $request->createdBy;
            $reservation->save();
            $balances->add($item->id, $warehouse->id, null, $request->lotId, BigDecimal::zero(), $qty);
            $balances->persist();

            return ReservationData::of($reservation->refresh(), Stock::qty($shortage));
        }));
    }

    public function release(string $companyId, string $reservationId): ReservationData
    {
        return $this->close($companyId, $reservationId, ReservationStatus::Released);
    }

    public function consume(string $companyId, string $reservationId): ReservationData
    {
        return $this->close($companyId, $reservationId, ReservationStatus::Consumed);
    }

    /**
     * Ends an active reservation and gives its quantity back to availability.
     */
    public function close(string $companyId, string $reservationId, ReservationStatus $status, ?int $version = null): ReservationData
    {
        return $this->company->runAs($companyId, fn (): ReservationData => Stock::transaction(function () use ($companyId, $reservationId, $status, $version): ReservationData {
            $found = StockReservation::query()->whereKey(Str::isUuid($reservationId) ? $reservationId : null)->firstOrFail();
            $balances = $this->lockPair($companyId, $found->item_id, $found->warehouse_id);
            $reservation = StockReservation::query()->whereKey($found->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $reservation->assertVersion($version);
            }

            if ($reservation->status !== ReservationStatus::Active) {
                Messages::fail('reservation', 'reservation_not_active');
            }

            $reservation->status = $status;
            $reservation->closed_at = now();
            $reservation->save();
            $balances->add($reservation->item_id, $reservation->warehouse_id, null, $reservation->lot_id, BigDecimal::zero(), $reservation->quantity->negated());
            $balances->persist();

            return ReservationData::of($reservation);
        }));
    }

    /**
     * Expires active reservations whose hold time is over, oldest first; returns how many.
     */
    public function expireDue(string $companyId, ?DateTimeInterface $now = null, int $limit = 1000): int
    {
        $ids = DB::table('stock_reservations')->where('company_id', $companyId)->where('status', ReservationStatus::Active->value)
            ->whereNotNull('expires_at')->where('expires_at', '<=', $now ?? now())->orderBy('expires_at')->limit($limit)->pluck('id');
        $count = 0;

        foreach ($ids as $id) {
            try {
                $this->close($companyId, (string) $id, ReservationStatus::Expired);
                $count++;
            } catch (ValidationException) {
                // Released or consumed meanwhile.
            }
        }

        return $count;
    }

    /** The pair's valuation row (its mutex), then its balance rows. */
    private function lockPair(string $companyId, string $itemId, string $warehouseId): Balances
    {
        (new CostBook($companyId))->lock([[$itemId, $warehouseId]], ValuationMethod::MovingAverage);
        $balances = new Balances($companyId);
        $balances->lock([[$itemId, $warehouseId]]);

        return $balances;
    }
}
