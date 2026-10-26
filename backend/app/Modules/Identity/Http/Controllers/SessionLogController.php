<?php

declare(strict_types=1);

namespace App\Modules\Identity\Http\Controllers;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Identity\Http\Resources\SessionLogResource;
use App\Modules\Identity\Models\SessionLog;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;

/**
 * Sign-in history. Company admins see entries of their company's members; super admins
 * also see attempts that matched no account.
 */
final class SessionLogController
{
    use CurrentUser;

    public function index(Request $request, CompanyContext $context, CompanyDirectory $companies): JsonResponse
    {
        Gate::authorize('viewAny', SessionLog::class);

        $range = Validator::make($request->query(), [
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ])->validate();

        $query = SessionLog::query();

        if (! $this->currentUser($request)->is_super_admin) {
            $companies->constrainToMembers($query, $context->id(), 'user_id');
        }

        if (isset($range['from']) && is_string($range['from'])) {
            $query->where('created_at', '>=', Carbon::parse($range['from']));
        }

        if (isset($range['to']) && is_string($range['to'])) {
            $query->where('created_at', '<=', Carbon::parse($range['to']));
        }

        if (! $request->has('sort')) {
            $query->orderByDesc('created_at');
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['created_at', 'event'], ['event', 'user_id'], ['email']),
            SessionLogResource::class,
        );
    }
}
