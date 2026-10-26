<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Modules\Accounting\Http\Requests\FxRevaluationRequest;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Services\FxRevaluation;
use DateTimeImmutable;
use Illuminate\Http\JsonResponse;

/**
 * dry_run (default true) only computes; dry_run=false books the revaluation and its reversal.
 */
final class FxRevaluationController extends AccountingController
{
    public function __construct(private readonly FxRevaluation $revaluation) {}

    public function store(FxRevaluationRequest $request): JsonResponse
    {
        $period = AccountingPeriod::query()->with('fiscalYear')->findOrFail($request->string('period_id')->toString());
        $dryRun = $request->has('dry_run') ? $request->boolean('dry_run') : true;
        $result = $this->revaluation->run($period, new DateTimeImmutable($request->string('rate_date')->toString()), $dryRun, $this->actor($request));

        return $dryRun ? ApiResponse::success($result) : ApiResponse::created($result);
    }
}
