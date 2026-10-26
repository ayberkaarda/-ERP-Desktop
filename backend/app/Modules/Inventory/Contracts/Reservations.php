<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Contracts;

use App\Modules\Inventory\Data\ReservationData;
use App\Modules\Inventory\Data\ReservationRequest;

/**
 * Stock held for documents (orders). The warehouse's reservation policy decides whether a
 * reservation beyond availability is refused (hard) or kept and reported (soft).
 */
interface Reservations
{
    public function reserve(ReservationRequest $request): ReservationData;

    /** Gives the held quantity back; only an active reservation can be released. */
    public function release(string $companyId, string $reservationId): ReservationData;

    /** Marks the reservation used by an issue (the issue itself is posted through StockService). */
    public function consume(string $companyId, string $reservationId): ReservationData;
}
