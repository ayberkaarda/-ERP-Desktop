<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Http\Requests\PeriodStatusRequest;
use App\Modules\Accounting\Http\Resources\AccountingPeriodResource;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Services\PeriodStatusService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Filters: fiscal_year_id, status, number. Every row carries draft_count (a close is blocked while > 0).
 */
final class AccountingPeriodController extends AccountingController
{
    public function __construct(private readonly PeriodStatusService $status) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AccountingPeriod::class);

        return ApiResponse::paginated(
            ListQuery::for($this->query(), $request, ['start_date', 'number'], ['fiscal_year_id', 'status', 'number'], []),
            AccountingPeriodResource::class,
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', AccountingPeriod::class);
        $period = $this->query()->findOrFail($id);
        Gate::authorize('view', $period);

        return ApiResponse::success($this->resolve(new AccountingPeriodResource($period), $request));
    }

    public function softClose(PeriodStatusRequest $request, string $id): JsonResponse
    {
        $period = $this->find($id, 'close');

        return $this->respond($request, $this->status->softClose($period, $this->actor($request), $request->optionalVersion()));
    }

    public function close(PeriodStatusRequest $request, string $id): JsonResponse
    {
        $period = $this->find($id, 'close');

        return $this->respond($request, $this->status->close($period, $this->actor($request), $request->optionalVersion()));
    }

    public function reopen(PeriodStatusRequest $request, string $id): JsonResponse
    {
        $period = $this->find($id, 'reopen');

        return $this->respond($request, $this->status->reopen($period, $this->actor($request), $request->string('reason')->toString(), $request->optionalVersion()));
    }

    private function find(string $id, string $ability): AccountingPeriod
    {
        $period = AccountingPeriod::query()->findOrFail($id);
        Gate::authorize($ability, $period);

        return $period;
    }

    private function respond(Request $request, AccountingPeriod $period): JsonResponse
    {
        return ApiResponse::success($this->resolve(new AccountingPeriodResource($this->query()->findOrFail($period->id)), $request));
    }

    /** @return Builder<AccountingPeriod> */
    private function query(): Builder
    {
        return AccountingPeriod::query()->withCount(['entries as draft_count' => fn (Builder $q) => $q->where('status', EntryStatus::Draft->value)]);
    }
}
