<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Http\Controllers;

use App\Core\Http\ApiResponse;
use App\Core\Http\ListQuery;
use App\Modules\Accounting\Http\Requests\DeterminationRuleRequest;
use App\Modules\Accounting\Http\Requests\DeterminationTestRequest;
use App\Modules\Accounting\Http\Resources\DeterminationRuleResource;
use App\Modules\Accounting\Models\AccountDeterminationRule;
use App\Modules\Accounting\Services\DeterminationRules;
use App\Modules\Accounting\Services\RuleDeterminer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Filters: event_key, is_active, is_system, account_id; q on event_key/description. Default order:
 * event key, then priority (highest first) as the resolver evaluates them.
 */
final class DeterminationRuleController extends AccountingController
{
    public function __construct(
        private readonly DeterminationRules $rules,
        private readonly RuleDeterminer $determiner,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', AccountDeterminationRule::class);
        $query = AccountDeterminationRule::query()->with('account');

        if ($request->query('sort') === null) {
            $query->orderBy('event_key')->orderByDesc('priority');
        }

        return ApiResponse::paginated(
            ListQuery::for($query, $request, ['event_key', 'priority', 'created_at'], ['event_key', 'is_active', 'is_system', 'account_id'], ['event_key', 'description']),
            DeterminationRuleResource::class,
        );
    }

    public function store(DeterminationRuleRequest $request): JsonResponse
    {
        return ApiResponse::created($this->resolve(new DeterminationRuleResource($this->rules->create($request->validated())), $request));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('viewAny', AccountDeterminationRule::class);
        $rule = AccountDeterminationRule::query()->with('account')->findOrFail($id);
        Gate::authorize('view', $rule);

        return ApiResponse::success($this->resolve(new DeterminationRuleResource($rule), $request));
    }

    public function update(DeterminationRuleRequest $request, string $id): JsonResponse
    {
        $rule = AccountDeterminationRule::query()->findOrFail($id);
        Gate::authorize('update', $rule);
        $rule = $this->rules->update($rule, collect($request->validated())->except('version')->all(), $request->integer('version'));

        return ApiResponse::success($this->resolve(new DeterminationRuleResource($rule), $request));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        Gate::authorize('delete', AccountDeterminationRule::class);
        $rule = AccountDeterminationRule::query()->findOrFail($id);
        Gate::authorize('delete', $rule);
        $this->rules->delete($rule, $this->deleteVersion($request));

        return ApiResponse::noContent();
    }

    /**
     * Preview: which account would {event_key, context} resolve to, and through which rule.
     */
    public function test(DeterminationTestRequest $request): JsonResponse
    {
        /** @var array<string, string|null> $context */
        $context = $request->validated('context') ?? [];
        $ref = $this->determiner->resolve($request->string('event_key')->toString(), $context);

        return ApiResponse::success([
            'event_key' => $request->string('event_key')->toString(),
            'account' => ['id' => $ref->id, 'code' => $ref->code, 'name' => $ref->name],
            'side' => $ref->side,
            'rule_id' => $ref->ruleId,
        ]);
    }
}
