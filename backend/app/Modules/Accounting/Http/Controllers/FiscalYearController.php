<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Accounting\Http\Requests\FiscalYearRequest;
use App\Modules\Accounting\Http\Requests\FiscalYearStatusRequest;
use App\Modules\Accounting\Http\Resources\FiscalYearResource;
use App\Modules\Accounting\Models\FiscalYear;
use App\Modules\Accounting\Services\FiscalCalendar;
use App\Modules\Accounting\Services\YearEndClosing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

final class FiscalYearController extends AccountingController
{
    public function __construct(
        private readonly FiscalCalendar $calendar,
        private readonly YearEndClosing $closing,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', FiscalYear::class);

        return ApiResponse::paginated(
            ListQuery::for(FiscalYear::query()->with('periods'), $request, ['code', 'start_date', 'created_at'], ['status', 'code'], ['code', 'name']),
            FiscalYearResource::class,
        );
    }

    public function store(FiscalYearRequest $request): JsonResponse
    {
        /** @var array{code: string, name?: string|null, start_date: string, end_date?: string|null, adjustment_period?: bool} $data */
        $data = $request->validated();

        return ApiResponse::created($this->resolve(new FiscalYearResource($this->calendar->create($data)), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', FiscalYear::class);
        $year = FiscalYear::query()->with('periods')->findOrFail($id);
        Gate::authorize('view', $year);

        return ApiResponse::success($this->resolve(new FiscalYearResource($year), $request));
    }

    public function update(FiscalYearRequest $request, string $id): JsonResponse
    {
        $year = FiscalYear::query()->findOrFail($id);
        Gate::authorize('update', $year);
        /** @var array{name?: string, start_date?: string, end_date?: string} $data */
        $data = collect($request->validated())->except('version')->all();

        return ApiResponse::success($this->resolve(new FiscalYearResource($this->calendar->update($year, $data, $request->integer('version'))), $request));
    }

    public function close(FiscalYearStatusRequest $request, string $id): JsonResponse
    {
        $year = FiscalYear::query()->findOrFail($id);
        Gate::authorize('close', $year);
        $year = $this->closing->close($year, $this->actor($request), $request->optionalVersion());

        return ApiResponse::success($this->resolve(new FiscalYearResource($year), $request));
    }

    public function reopen(FiscalYearStatusRequest $request, string $id): JsonResponse
    {
        $year = FiscalYear::query()->findOrFail($id);
        Gate::authorize('reopen', $year);
        $year = $this->closing->reopen($year, $request->string('reason')->toString(), $this->actor($request), $request->optionalVersion());

        return ApiResponse::success($this->resolve(new FiscalYearResource($year), $request));
    }
}
