<?php

declare(strict_types=1);

namespace App\Modules\Sales\Assistant;

use App\Modules\Sales\Enums\OrderStatus;
use App\Modules\Sales\Models\SalesOrder;

final class ReadService
{
    /** @return array<string, mixed> */
    public function overdueOrders(string $asOf, int $page): array
    {
        $d = ['as_of' => $asOf, 'page' => $page];
        $rows = SalesOrder::query()->whereIn('status', OrderStatus::openValues())->where('requested_delivery_date', '<', $d['as_of'])->orderBy('requested_delivery_date')->orderBy('id')->offset(((int) $d['page'] - 1) * 20)->limit(21)->get();

        return ['has_more' => $rows->count() > 20, 'page' => (int) $d['page'], 'orders' => $rows->take(20)->map(static fn (SalesOrder $order): array => ['id' => $order->id, 'number' => $order->number, 'party_id' => $order->party_id, 'requested_delivery_date' => $order->requested_delivery_date?->format('Y-m-d'), 'status' => $order->status->value, 'currency_code' => $order->currency_code, 'total' => (string) $order->total])->values()->all()];
    }
}
