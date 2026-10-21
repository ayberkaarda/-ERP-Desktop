<?php

declare(strict_types=1);

namespace App\Modules\Sales\Services;

use App\Modules\Sales\Enums\ReturnStatus;
use App\Modules\Sales\Models\SalesDeliveryLine;
use App\Modules\Sales\Models\SalesInvoiceLine;
use App\Modules\Sales\Models\SalesReturn;
use App\Modules\Sales\Models\SalesReturnLine;

/**
 * Serial numbers a return may still take back per invoice line: those shipped on the line's
 * delivery line and not on a non-cancelled return (the rule ReturnService enforces).
 */
final class ReturnableSerials
{
    /**
     * @param  iterable<SalesInvoiceLine>  $lines
     * @return array<string, list<string>> invoice line id => serials
     */
    public static function forLines(iterable $lines): array
    {
        $deliveryOf = [];

        foreach ($lines as $line) {
            if ($line->delivery_line_id !== null) {
                $deliveryOf[$line->id] = $line->delivery_line_id;
            }
        }

        if ($deliveryOf === []) {
            return [];
        }

        $shipped = SalesDeliveryLine::query()->whereIn('id', array_values($deliveryOf))->get()->keyBy('id');
        $taken = [];

        foreach (SalesReturnLine::query()->whereIn('delivery_line_id', array_values($deliveryOf))
            ->whereIn('document_id', SalesReturn::query()->select('id')->where('status', '<>', ReturnStatus::Cancelled->value))
            ->get() as $returned) {
            $taken[$returned->delivery_line_id] = [...($taken[$returned->delivery_line_id] ?? []), ...$returned->serial_numbers];
        }

        $out = [];

        foreach ($deliveryOf as $lineId => $deliveryLineId) {
            $serials = $shipped->get($deliveryLineId)->serial_numbers ?? [];
            $out[$lineId] = array_values(array_diff($serials, $taken[$deliveryLineId] ?? []));
        }

        return $out;
    }
}
