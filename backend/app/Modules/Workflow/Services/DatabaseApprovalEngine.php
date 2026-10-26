<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Services;

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use App\Modules\Workflow\Contracts\ApproverResolver;
use App\Modules\Workflow\Events\ApprovalCancelled;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Events\ApprovalRejected;
use App\Modules\Workflow\Models\ApprovalFlow;
use App\Modules\Workflow\Models\ApprovalFlowStep;
use App\Modules\Workflow\Models\ApprovalRequest;
use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use Brick\Math\RoundingMode;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

final class DatabaseApprovalEngine implements ApprovalEngine
{
    public function __construct(
        private readonly CompanyContext $context,
        private readonly ApproverResolver $resolver,
        private readonly ApprovalStateMachine $machine,
    ) {}

    public function start(Model $doc, string $docType, ?string $amount, ?string $revision = null): ApprovalRequest
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

        return DB::transaction(function () use ($doc, $docType, $amount, $revision, $company, $actor): ApprovalRequest {
            // The document lock serializes starts even when no flow exists.
            $doc->newQuery()->whereKey($doc->getKey())->lockForUpdate()->firstOrFail();
            $existing = ApprovalRequest::query()->where('document_type', $docType)
                ->where('document_id', $doc->getKey())->where('status', 'pending')->first();
            if ($existing !== null) {
                if ($existing->amount === $amount && $existing->revision === $revision) {
                    return $existing;
                }
                // The document changed after submission: the old decision chain no longer applies.
                $this->machine->transition($existing, 'cancelled', $actor);
                $this->announceCancelled($existing);
            }
            $flow = ApprovalFlow::query()->where('document_type', $docType)->where('is_active', true)
                ->lockForUpdate()->first();
            if ($amount === null && $flow !== null && $flow->steps->contains(
                fn (ApprovalFlowStep $step): bool => $step->min_amount !== null || $step->max_amount !== null,
            )) {
                $message = __('workflow::messages.amount_required');
                throw new ApiException(ErrorCode::ValidationError, $message, ['amount' => [$message]]);
            }
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
                'amount' => $amount, 'revision' => $revision, 'requested_by' => (string) $actor->getAuthIdentifier(),
                'allow_self_approval' => $flow->allow_self_approval ?? false,
            ]);
            $request->save();
            if ($steps === []) {
                $this->finish($request, 'approved', $actor);
            } else {
                $this->activate($request, $steps[0]);
            }

            return $request;
        });
    }

    public function decide(ApprovalRequest $r, Authenticatable $actor, string $decision, ?string $comment = null, ?int $expectedVersion = null, ?int $expectedStep = null): ApprovalRequest
    {
        $this->assertCompany($r);
        if (! in_array($decision, ['approve', 'reject'], true)) {
            throw new ApiException(ErrorCode::ValidationError);
        }

        return DB::transaction(function () use ($r, $actor, $decision, $comment, $expectedVersion, $expectedStep): ApprovalRequest {
            $locked = ApprovalRequest::query()->whereKey($r->id)->lockForUpdate()->firstOrFail();
            $actorId = (string) $actor->getAuthIdentifier();
            // A retry is tied to the step observed by its caller, never the next step.
            $previous = $locked->decisions()->where('step_position', $expectedStep ?? $r->current_step)->where('actor_id', $actorId)->first();
            if ($previous !== null) {
                if ($previous->decision !== $decision || $previous->comment !== $comment) {
                    throw new ApiException(ErrorCode::IdempotencyKeyReused);
                }

                return $locked;
            }
            if ($expectedStep !== null && $locked->current_step !== $expectedStep) {
                throw new ApiException(ErrorCode::VersionConflict);
            }
            $locked->assertVersion($expectedVersion ?? $r->currentVersion());
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
                DB::table('approval_request_approvers')->where('request_id', $locked->id)
                    ->where('step_position', $step['position'])->where('approver_ref', $actorId)->delete();
                $locked->bumpVersion()->save();

                return $locked;
            }
            $next = null;
            foreach ($locked->steps as $candidate) {
                if ($candidate['position'] > $step['position']) {
                    $next = $candidate;
                    break;
                }
            }
            if ($next === null) {
                $this->finish($locked, 'approved', $actor);
            } else {
                $locked->current_step = $next['position'];
                $locked->save();
                DB::table('approval_request_approvers')->where('request_id', $locked->id)->delete();
                $this->activate($locked, $next);
            }

            return $locked;
        });
    }

    public function pendingFor(Authenticatable $user): Builder
    {
        $id = (string) $user->getAuthIdentifier();
        $company = $this->context->id();

        return ApprovalRequest::query()->where('status', 'pending')
            ->whereExists(function (QueryBuilder $query) use ($id, $company): void {
                $query->selectRaw('1')->from('approval_request_approvers')
                    ->whereColumn('approval_request_approvers.request_id', 'approval_requests.id')
                    ->whereColumn('approval_request_approvers.step_position', 'approval_requests.current_step')
                    ->where('approval_request_approvers.company_id', $company)
                    ->where('approval_request_approvers.approver_type', 'user')
                    ->where('approval_request_approvers.approver_ref', $id);
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
            $this->announceCancelled($locked);

            return $locked;
        });
    }

    private function assertCompany(ApprovalRequest $request): void
    {
        if ($request->company_id !== $this->context->id()) {
            throw new ApiException(ErrorCode::CompanyForbidden);
        }
    }

    /** @param array{position: int, mode: string, approvers: list<string>} $step */
    private function activate(ApprovalRequest $request, array $step): void
    {
        DB::table('approval_request_approvers')->insert(array_map(static fn (string $approver): array => [
            'company_id' => $request->company_id, 'request_id' => $request->id,
            'step_position' => $step['position'], 'approver_type' => 'user', 'approver_ref' => $approver,
        ], $step['approvers']));
    }

    private function announceCancelled(ApprovalRequest $request): void
    {
        event(new ApprovalCancelled($request->id, $request->company_id, $request->document_id, $request->document_type));
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
