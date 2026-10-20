<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
use App\Core\Documents\StateMachine;
use App\Modules\Workflow\Contracts\ApproverResolver;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Events\ApprovalRejected;
use App\Modules\Workflow\Services\ApprovalStateMachine;
use App\Modules\Workflow\Services\DatabaseApprovalEngine;
use App\Modules\Workflow\Services\SpatieApproverResolver;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

it('compares amount thresholds without losing decimal precision', function (?string $amount, ?string $min, ?string $max, bool $expected): void {
    $resolver = new class implements ApproverResolver
    {
        public function resolve(string $companyId, string $type, string $reference): array
        {
            return [];
        }
    };
    $engine = new DatabaseApprovalEngine(new CompanyContext, $resolver, new ApprovalStateMachine);
    expect($engine->withinRange($amount, $min, $max))->toBe($expected);
})->with([
    ['100.0000', '100', '100.0000', true],
    ['99.9999', '100', null, false],
    ['100.0001', null, '100', false],
    ['9999999999999999.9998', '9999999999999999.9999', null, false],
    ['9999999999999999.9999', '9999999999999999.9999', null, true],
    [null, null, null, true],
    [null, '0', null, false],
    [null, null, '100', false],
    ['0', null, null, true],
]);

it('uses the core state machine and makes terminal states final', function (): void {
    $machine = new ApprovalStateMachine;
    expect($machine)->toBeInstanceOf(StateMachine::class)
        ->and($machine->allowedFrom('pending'))->toBe(['approved', 'rejected', 'cancelled'])
        ->and($machine->allowedFrom('approved'))->toBe([])
        ->and($machine->allowedFrom('rejected'))->toBe([])
        ->and($machine->allowedFrom('cancelled'))->toBe([]);
});

it('publishes completion and rejection only after commit', function (): void {
    foreach ([ApprovalCompleted::class, ApprovalRejected::class] as $class) {
        $event = new $class('request', 'company', 'document', 'purchase_order');
        expect($event)->toBeInstanceOf(ShouldDispatchAfterCommit::class)
            ->and($event->documentId)->toBe('document')
            ->and($event->documentType)->toBe('purchase_order');
    }
});

it('checks company membership for explicit user approvers', function (): void {
    $company = '01900000-0000-7000-8000-000000000001';
    $member = '01900000-0000-7000-8000-000000000002';
    $membership = new class($company, $member) implements MembershipChecker
    {
        public function __construct(private readonly string $company, private readonly string $member) {}

        public function isMember(string $userId, string $companyId): bool
        {
            return $userId === $this->member && $companyId === $this->company;
        }
    };
    $resolver = new SpatieApproverResolver($membership);
    expect($resolver->resolve($company, 'user', $member))->toBe([$member])
        ->and($resolver->resolve('01900000-0000-7000-8000-000000000003', 'user', $member))->toBe([])
        ->and($resolver->resolve($company, 'user', 'invalid'))->toBe([])
        ->and($resolver->resolve($company, 'unknown', $member))->toBe([]);
});
