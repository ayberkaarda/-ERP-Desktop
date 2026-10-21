<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Inventory\Data\ReservationRequest;
use App\Modules\Inventory\Enums\ReservationStatus;
use App\Modules\Inventory\Http\Requests\ReleaseReservationRequest;
use App\Modules\Inventory\Http\Requests\StoreReservationRequest;
use App\Modules\Inventory\Http\Resources\StockReservationResource;
use App\Modules\Inventory\Models\StockReservation;
use App\Modules\Inventory\Services\ReservationBook;
use DateTimeImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Filters: status, item_id, warehouse_id, lot_id, source_type, source_id; q on notes.
 */
final class ReservationController extends InventoryController
{
    public function __construct(private readonly ReservationBook $reservations) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', StockReservation::class);
        $query = StockReservation::query();

        if ($request->query('sort') === null) {
            $query->orderByDesc('created_at');
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['created_at', 'expires_at', 'quantity', 'status'], ['status', 'item_id', 'warehouse_id', 'lot_id', 'source_type', 'source_id'], ['notes']),
            StockReservationResource::class,
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', StockReservation::class);
        $reservation = StockReservation::query()->findOrFail($id);
        Gate::authorize('view', $reservation);

        return ApiResponse::success($this->resolve(new StockReservationResource($reservation), $request));
    }

    /**
     * Reserves stock; meta.shortage reports how much exceeded availability (soft policy).
     */
    public function store(StoreReservationRequest $request): JsonResponse
    {
        $expires = $request->validated('expires_at');
        $data = $this->reservations->reserve(new ReservationRequest(
            $this->companyId(),
            $request->string('item_id')->toString(),
            $request->string('warehouse_id')->toString(),
            $request->string('quantity')->toString(),
            $request->filled('lot_id') ? $request->string('lot_id')->toString() : null,
            $request->filled('source_type') ? $request->string('source_type')->toString() : null,
            $request->filled('source_id') ? $request->string('source_id')->toString() : null,
            is_string($expires) ? new DateTimeImmutable($expires) : null,
            $this->actor($request),
            $request->filled('notes') ? $request->string('notes')->toString() : null,
        ));
        $reservation = StockReservation::query()->findOrFail($data->id);

        return ApiResponse::success($this->resolve(new StockReservationResource($reservation), $request), ['shortage' => $data->shortage, 'replayed' => $data->replayed], 201);
    }

    public function release(ReleaseReservationRequest $request, string $id): JsonResponse
    {
        $reservation = StockReservation::query()->findOrFail($id);
        Gate::authorize('release', $reservation);
        $this->reservations->close($this->companyId(), $reservation->id, ReservationStatus::Released, $request->optionalVersion());

        return ApiResponse::success($this->resolve(new StockReservationResource($reservation->refresh()), $request));
    }
}
