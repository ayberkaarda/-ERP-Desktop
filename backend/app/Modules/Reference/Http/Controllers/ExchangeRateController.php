<?php

declare(strict_types=1);

namespace App\Modules\Reference\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Reference\Http\Resources\ReferenceResource;
use App\Modules\Reference\Models\ExchangeRate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;

final class ExchangeRateController
{
    public function latest(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', [ExchangeRate::class, ExchangeRate::class]);
        $input = $request->validate(['currency' => ['required', 'string', 'regex:/^[A-Z]{3}$/']]);
        $rate = ExchangeRate::query()->where('currency_code', $input['currency'])
            ->where('rate_date', '<=', now('Europe/Istanbul')->toDateString())->orderByDesc('rate_date')
            ->orderByRaw("CASE WHEN source = 'manual' THEN 0 ELSE 1 END")->firstOrFail();

        return ApiResponse::success((new ReferenceResource($rate))->resolve($request));
    }

    public function status(): JsonResponse
    {
        Gate::authorize('viewAny', [ExchangeRate::class, ExchangeRate::class]);
        $last = ExchangeRate::query()->where('source', 'tcmb')->max('rate_date');
        $days = is_string($last) ? (int) Carbon::parse($last, 'Europe/Istanbul')->startOfDay()->diffInDays(now('Europe/Istanbul')->startOfDay()) : null;

        return ApiResponse::success([
            'last_fetch_date' => $last, 'stale_days' => $days, 'is_stale' => $days === null || $days > 4,
        ]);
    }
}
