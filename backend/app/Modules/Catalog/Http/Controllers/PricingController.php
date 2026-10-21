<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Catalog\Contracts\PriceResolver;
use App\Modules\Catalog\Http\Requests\ResolvePriceRequest;
use App\Modules\Catalog\Models\DiscountRule;
use App\Modules\Catalog\Models\Item;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;

final class PricingController extends CatalogController
{
    public function __construct(private readonly PriceResolver $resolver) {}

    /**
     * GET /pricing/resolve?item_id=&variant_id=&party_id=&qty=&unit_id=&date=&currency=
     */
    public function resolvePrice(ResolvePriceRequest $request): JsonResponse
    {
        Gate::authorize('resolve', DiscountRule::class);

        /** @var array{item_id: string, variant_id?: string|null, party_id?: string|null, qty?: string, unit_id?: string|null, date?: string, currency: string} $input */
        $input = $request->validated();
        $item = Item::query()->findOrFail($input['item_id']);
        $qty = $input['qty'] ?? '1';
        $unit = $input['unit_id'] ?? $item->base_unit_id;
        $date = (isset($input['date']) ? Carbon::createFromFormat('!Y-m-d', $input['date'], 'UTC') : null) ?? Carbon::now('UTC');

        $price = $this->resolver->resolve(
            $item->id,
            $input['variant_id'] ?? null,
            $input['party_id'] ?? null,
            $qty,
            $unit,
            $date,
            $input['currency'],
        );

        return ApiResponse::success([
            'item_id' => $item->id,
            'variant_id' => $input['variant_id'] ?? null,
            'party_id' => $input['party_id'] ?? null,
            'qty' => $qty,
            'unit_id' => $unit,
            'date' => $date->toDateString(),
            ...$price->toArray(),
        ]);
    }
}
