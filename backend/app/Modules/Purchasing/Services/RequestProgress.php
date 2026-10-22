<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Services;

use App\Modules\Purchasing\Enums\RequestStatus;
use App\Modules\Purchasing\Models\PurchaseRequest;
use App\Modules\Purchasing\Models\PurchaseRequestLine;
use App\Modules\Purchasing\Services\Machines\RequestMachine;

/**
 * Derives approved / partially_ordered / ordered of a request from the orders (not cancelled,
 * drafts included) created from its lines.
 */
final class RequestProgress
{
    public function __construct(
        private readonly RequestMachine $machine,
        private readonly Quantities $quantities,
    ) {}

    public function refresh(?string $requestId): void
    {
        if ($requestId === null) {
            return;
        }

        $request = PurchaseRequest::query()->whereKey($requestId)->lockForUpdate()->first();

        if ($request === null || ! in_array($request->status, [...RequestStatus::open(), RequestStatus::Ordered], true)) {
            return;
        }

        $all = true;
        $any = false;

        foreach ($request->lines()->get() as $line) {
            $ordered = $this->quantities->orderedOnRequest($line->id);
            $all = $all && $ordered->isGreaterThanOrEqualTo($line->quantity);
            $any = $any || $ordered->isPositive();
        }

        $target = match (true) {
            $all => RequestStatus::Ordered,
            $any => RequestStatus::PartiallyOrdered,
            default => RequestStatus::Approved,
        };

        if ($target !== $request->status) {
            $this->machine->transition($request, $target);
        }
    }

    /**
     * Requests of the given request lines.
     *
     * @param  list<string|null>  $requestLineIds
     * @return list<string>
     */
    public static function requestsOf(array $requestLineIds): array
    {
        $ids = array_values(array_filter($requestLineIds, 'is_string'));

        if ($ids === []) {
            return [];
        }

        return array_values(array_map('strval', PurchaseRequestLine::query()->whereIn('id', $ids)
            ->distinct()->pluck('document_id')->all()));
    }
}
