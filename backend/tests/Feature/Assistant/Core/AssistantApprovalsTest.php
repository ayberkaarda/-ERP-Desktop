<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Accounting\Contracts\AssistantTools;
use App\Modules\Assistant\Agents\ErpAssistant;
use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Assistant\Enums\ToolStatus;
use App\Modules\Assistant\Exceptions\AssistantException;
use App\Modules\Assistant\Models\ToolCall;
use App\Modules\Assistant\Services\ConversationService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Ai\Responses\Data\ToolCall as SdkCall;
use Tests\Support\Actors;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    config(['assistant.enabled' => true, 'assistant.provider' => 'openai', 'assistant.model' => 'test-model']);
    $this->company = Actors::company();
    $this->user = Actors::user(['assistant.use', 'accounting.entries.create']);
    Actors::activate($this->company);
    $this->count = (object) ['calls' => 0, 'fail' => false];
    app()->instance(AssistantTools::class, new class($this->count) implements AssistantTools
    {
        public function __construct(private readonly object $count) {}

        public function tools(User $actor): array
        {
            return [new ErpTool($actor, app(CompanyContext::class)->id(), 'draft_test', 'Create test draft', ['accounting.entries.create'], 'draft', static fn (): array => [], function (): array {
                if ($this->count->fail) {
                    throw ValidationException::withMessages(['date' => 'The fiscal period is closed.']);
                }
                $this->count->calls++;

                return ['id' => 'draft-1', 'url' => '/accounting/journal/draft-1', 'status' => 'draft'];
            })];
        }
    });
    ErpAssistant::fake([new SdkCall('call-test', 'draft_test', [])]);
    $this->service = app(ConversationService::class);
    $this->conversation = $this->service->create($this->user, 'Draft');
    $turn = $this->service->begin($this->user, $this->conversation->id, (string) Str::uuid7(), 'Create a draft', []);
    $this->service->run($this->user, $turn, static function (): void {});
    $this->call = ToolCall::query()->where('status', ToolStatus::Pending->value)->firstOrFail();
});

it('pauses a draft until approval and executes stored arguments once', function (): void {
    expect($this->count->calls)->toBe(0);
    expect(fn () => $this->service->begin($this->user, $this->conversation->id, (string) Str::uuid7(), 'Another', []))->toThrow(AssistantException::class);
    $this->service->decide($this->user, $this->conversation->id, $this->call->id, true);
    $this->service->decide($this->user, $this->conversation->id, $this->call->id, true);
    expect($this->count->calls)->toBe(1)->and($this->call->refresh()->status)->toBe(ToolStatus::Completed);
    expect(fn () => $this->service->decide($this->user, $this->conversation->id, $this->call->id, false))->toThrow(AssistantException::class);
    ErpAssistant::assertPromptedTimes(1);
});

it('rejects a draft without executing it or calling the provider again', function (): void {
    $this->service->decide($this->user, $this->conversation->id, $this->call->id, false);
    $this->service->decide($this->user, $this->conversation->id, $this->call->id, false);
    expect($this->count->calls)->toBe(0)->and($this->call->refresh()->status)->toBe(ToolStatus::Rejected);
    ErpAssistant::assertPromptedTimes(1);
});

it('rechecks source document permissions on approval', function (): void {
    Actors::revoke($this->user, $this->company);
    Actors::grant($this->user, $this->company, ['assistant.use']);
    expect(fn () => $this->service->decide($this->user, $this->conversation->id, $this->call->id, true))->toThrow(AssistantException::class);
    expect($this->count->calls)->toBe(0)->and($this->call->refresh()->status)->toBe(ToolStatus::Pending);
    expect(ToolCall::query()->where('status', ToolStatus::Failed->value)->count())->toBe(1);
});

it('rechecks disabled mode before approving', function (): void {
    config(['assistant.enabled' => false]);
    expect(fn () => $this->service->decide($this->user, $this->conversation->id, $this->call->id, true))->toThrow(AssistantException::class);
    expect($this->count->calls)->toBe(0);
});

it('keeps a failed domain validation pending and audits the failed attempt', function (): void {
    $this->count->fail = true;
    expect(fn () => $this->service->decide($this->user, $this->conversation->id, $this->call->id, true))->toThrow(ValidationException::class);
    expect($this->call->refresh()->status)->toBe(ToolStatus::Pending)->and($this->count->calls)->toBe(0);
    expect(ToolCall::query()->where('status', ToolStatus::Failed->value)->count())->toBe(1);
    $this->count->fail = false;
    $this->service->decide($this->user, $this->conversation->id, $this->call->id, true);
    expect($this->count->calls)->toBe(1);
});

it('refuses approval identifiers outside their user and company', function (): void {
    $other = Actors::user(['assistant.use', 'accounting.entries.create']);
    expect(fn () => $this->service->decide($other, $this->conversation->id, $this->call->id, true))->toThrow(ModelNotFoundException::class);
    Actors::activate(Actors::companyFor($this->user, ['assistant.use']));
    expect(fn () => $this->service->decide($this->user, $this->conversation->id, $this->call->id, true))->toThrow(ModelNotFoundException::class);
    expect($this->count->calls)->toBe(0);
});
