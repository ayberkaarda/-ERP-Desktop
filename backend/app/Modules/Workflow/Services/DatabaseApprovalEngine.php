<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use App\Modules\Workflow\Contracts\ApproverResolver;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Events\ApprovalRejected;
use App\Modules\Workflow\Models\ApprovalFlow;
use App\Modules\Workflow\Models\ApprovalRequest;
use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use Brick\Math\RoundingMode;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

final class DatabaseApprovalEngine implements ApprovalEngine
{
    public function __construct(
        private readonly CompanyContext $context,
        private readonly ApproverResolver $resolver,
        private readonly ApprovalStateMachine $machine,
    ) {}

    public function start(Model $doc, string $docType, ?string $amount): ApprovalRequest
    {
        $company = $this->context->id();
        if (! $doc->exists || $doc->getAttribute('company_id') !== $company) {
            throw new ApiException(ErrorCode::CompanyForbidden);
        }
        $actor = Auth::user();
        if ($actor === null) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }
        $amount = $this->decimal($amount);

        return DB::transaction(function () use ($doc, $docType, $amount, $company, $actor): ApprovalRequest {
            // The document lock serializes starts even when no flow exists.
            $doc->newQuery()->whereKey($doc->getKey())->lockForUpdate()->firstOrFail();
            $existing = ApprovalRequest::query()->where('document_type', $docType)
                ->where('document_id', $doc->getKey())->where('status', 'pending')->first();
            if ($existing !== null) {
                return $existing;
            }
            $flow = ApprovalFlow::query()->where('document_type', $docType)->where('is_active', true)
                ->lockForUpdate()->first();
            $steps = [];
            foreach ($flow->steps ?? [] as $step) {
                if (! $this->withinRange($amount, $step->min_amount, $step->max_amount)) {
                    continue;
                }
                $approvers = $this->resolver->resolve($company, $step->approver_type, $step->approver_ref);
                if (! ($flow->allow_self_approval ?? false)) {
                    $approvers = array_values(array_diff($approvers, [(string) $actor->getAuthIdentifier()]));
                }
                if ($approvers === []) {
                    throw new ApiException(ErrorCode::ValidationError, __('workflow::messages.no_approvers'));
                }
                $steps[] = ['position' => $step->position, 'mode' => $step->mode, 'approvers' => array_values(array_unique($approvers))];
            }
            $request = new ApprovalRequest;
            $request->fill([
                'flow_id' => $flow?->id, 'document_type' => $docType,
                'document_id' => (string) $doc->getKey(), 'status' => 'pending',
                'current_step' => $steps[0]['position'] ?? null, 'steps' => $steps,
                'amount' => $amount, 'requested_by' => (string) $actor->getAuthIdentifier(),
                'allow_self_approval' => $flow->allow_self_approval ?? false,
            ]);
            $request->save();
            if ($steps === []) {
                $this->finish($request, 'approved', $actor);
            }

            return $request;
        });
    }

    public function decide(ApprovalRequest $r, Authenticatable $actor, string $decision, ?string $comment = null): ApprovalRequest
    {
        $this->assertCompany($r);
        if (! in_array($decision, ['approve', 'reject'], true)) {
            throw new ApiException(ErrorCode::ValidationError);
        }

        return DB::transaction(function () use ($r, $actor, $decision, $comment): ApprovalRequest {
            $locked = ApprovalRequest::query()->whereKey($r->id)->lockForUpdate()->firstOrFail();
            $actorId = (string) $actor->getAuthIdentifier();
            // A retry is tied to the step observed by its caller, never the next step.
            $previous = $locked->decisions()->where('step_position', $r->current_step)->where('actor_id', $actorId)->first();
            if ($previous !== null) {
                if ($previous->decision !== $decision || $previous->comment !== $comment) {
                    throw new ApiException(ErrorCode::IdempotencyKeyReused);
                }

                return $locked;
            }
            $locked->assertVersion($r->currentVersion());
            $step = $locked->activeStep();
            if ($locked->status !== 'pending' || $step === null) {
                throw new ApiException(ErrorCode::InvalidStateTransition);
            }
            if ((! $locked->allow_self_approval && $locked->requested_by === $actorId)
                || ! in_array($actorId, $step['approvers'], true)) {
                throw new ApiException(ErrorCode::Forbidden, __('workflow::messages.not_approver'));
            }
            $locked->decisions()->create([
                'step_position' => $step['position'], 'actor_id' => $actorId,
                'decision' => $decision, 'comment' => $comment, 'decided_at' => now(),
            ]);
            if ($decision === 'reject') {
                $this->finish($locked, 'rejected', $actor);

                return $locked;
            }
            $approved = $locked->decisions()->where('step_position', $step['position'])
                ->where('decision', 'approve')->pluck('actor_id')->all();
            if ($step['mode'] === 'all_of' && array_diff($step['approvers'], $approved) !== []) {
                $locked->bumpVersion()->save();

                return $locked;
            }
            $next = null;
            foreach ($locked->steps as $candidate) {
                if ($candidate['position'] > $step['position']) {
                    $next = $candidate['position'];
                    break;
                }
            }
            if ($next === null) {
                $this->finish($locked, 'approved', $actor);
            } else {
                $locked->current_step = $next;
                $locked->save();
            }

            return $locked;
        });
    }

    public function pendingFor(Authenticatable $user): Builder
    {
        $id = (string) $user->getAuthIdentifier();
        $this->context->id();

        return ApprovalRequest::query()->where('status', 'pending')
            ->where(function (Builder $query) use ($id): void {
                $query->where('allow_self_approval', true)->orWhere('requested_by', '!=', $id);
            })
            ->whereRaw("EXISTS (SELECT 1 FROM jsonb_array_elements(approval_requests.steps) AS step WHERE (step->>'position')::integer = approval_requests.current_step AND (step->'approvers') @> ?::jsonb)", [json_encode([$id], JSON_THROW_ON_ERROR)])
            ->whereDoesntHave('decisions', function (Builder $query) use ($id): void {
                $query->where('actor_id', $id)->whereColumn('step_position', 'approval_requests.current_step');
            });
    }

    public function cancel(ApprovalRequest $r, Authenticatable $actor): ApprovalRequest
    {
        $this->assertCompany($r);

        return DB::transaction(function () use ($r, $actor): ApprovalRequest {
            $locked = ApprovalRequest::query()->whereKey($r->id)->lockForUpdate()->firstOrFail();
            if ($locked->requested_by !== (string) $actor->getAuthIdentifier()) {
                throw new ApiException(ErrorCode::Forbidden);
            }
            $locked->assertVersion($r->currentVersion());
            $this->machine->transition($locked, 'cancelled', $actor);

            return $locked;
        });
    }

    private function assertCompany(ApprovalRequest $request): void
    {
        if ($request->company_id !== $this->context->id()) {
            throw new ApiException(ErrorCode::CompanyForbidden);
        }
    }

    private function finish(ApprovalRequest $request, string $status, Authenticatable $actor): void
    {
        $this->machine->transition($request, $status, $actor);
        $event = $status === 'approved' ? ApprovalCompleted::class : ApprovalRejected::class;
        event(new $event($request->id, $request->company_id, $request->document_id, $request->document_type));
    }

    private function decimal(?string $amount): ?string
    {
        if ($amount === null) {
            return null;
        }
        try {
            $value = BigDecimal::of($amount)->toScale(4, RoundingMode::Unnecessary);
            if ($value->abs()->isGreaterThan('9999999999999999.9999')) {
                throw new ApiException(ErrorCode::ValidationError);
            }

            return (string) $value;
        } catch (MathException $e) {
            throw new ApiException(ErrorCode::ValidationError, previous: $e);
        }
    }

    public function withinRange(?string $amount, ?string $min, ?string $max): bool
    {
        if ($amount === null) {
            return $min === null && $max === null;
        }
        $value = BigDecimal::of($amount);

        return ($min === null || $value->isGreaterThanOrEqualTo($min))
            && ($max === null || $value->isLessThanOrEqualTo($max));
    }
}
