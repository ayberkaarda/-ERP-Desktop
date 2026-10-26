<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Services;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Agents\ErpAssistant;
use App\Modules\Assistant\Contracts\ToolExecutionContext;
use App\Modules\Assistant\Data\Turn;
use App\Modules\Assistant\Enums\MessageStatus;
use App\Modules\Assistant\Enums\ToolStatus;
use App\Modules\Assistant\Exceptions\AssistantException;
use App\Modules\Assistant\Models\Conversation;
use App\Modules\Assistant\Models\Message;
use App\Modules\Assistant\Models\ToolCall;
use App\Modules\Assistant\Tools\ToolRegistry;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Ai\Responses\AgentResponse;
use Laravel\Ai\Tools\Request;
use Throwable;

final readonly class ConversationService
{
    public function __construct(private CompanyContext $context, private AssistantAccess $access, private PrivacyFilter $privacy, private TokenBudget $budget) {}

    /** @return Builder<Conversation> */
    public function owned(User $user): Builder
    {
        return Conversation::query()->where('company_id', $this->context->id())->where('user_id', $user->id);
    }

    public function find(User $user, string $id): Conversation
    {
        return DB::transaction(function () use ($user, $id): Conversation {
            $conversation = $this->owned($user)->lockForUpdate()->findOrFail($id);
            app(TurnRecovery::class)->recover($conversation);

            return $conversation;
        });
    }

    public function create(User $user, string $title): Conversation
    {
        return Conversation::query()->create(['company_id' => $this->context->id(), 'user_id' => $user->id, 'title' => $this->privacy->text($title)]);
    }

    /** @return array<string,mixed> */
    public function detail(Conversation $conversation): array
    {
        $query = Message::query()->where('conversation_id', $conversation->id)->where('company_id', $conversation->company_id)->where('user_id', $conversation->user_id);
        $hasMore = (clone $query)->count() > 20;
        $messages = $query->orderByDesc('id')->limit(20)->get()->reverse()->values();
        $calls = ToolCall::query()->whereIn('message_id', $messages->pluck('id'))->where('company_id', $conversation->company_id)->where('user_id', $conversation->user_id)->orderBy('id')->get()->groupBy('message_id');
        $detail = [...$this->summary($conversation), 'has_more_messages' => $hasMore, 'messages' => $messages->map(static fn (Message $m): array => [
            'id' => $m->id, 'request_id' => $m->request_id, 'role' => $m->role, 'content' => $m->content, 'status' => $m->status->value,
            'context' => $m->context, 'created_at' => $m->created_at->toISOString(),
            'tool_calls' => $calls->get($m->id, collect())->filter(static fn (ToolCall $call): bool => $call->status === ToolStatus::Pending)->concat($calls->get($m->id, collect())->filter(static fn (ToolCall $call): bool => $call->status !== ToolStatus::Pending)->take(-8))->map(static fn (ToolCall $call): array => [
                'id' => $call->id, 'tool' => $call->tool, 'kind' => $call->kind, 'status' => $call->status->value,
                'arguments' => $call->status === ToolStatus::Pending ? $call->preview : self::boundedResult($call->preview), 'result' => self::boundedResult($call->result), 'reason' => $call->reason,
            ])->all(),
        ])->all()];
        while (strlen((string) json_encode($detail, JSON_THROW_ON_ERROR)) > 900000 && count($detail['messages']) > 2) {
            $detail['messages'] = array_slice($detail['messages'], 2);
            $detail['has_more_messages'] = true;
        }

        return $detail;
    }

    private static function boundedResult(mixed $result): mixed
    {
        $json = (string) json_encode($result);

        return strlen($json) > 2000 ? ['truncated' => true, 'preview' => mb_substr($json, 0, 1800)] : $result;
    }

    /** @return array<string,mixed> */
    public function summary(Conversation $c): array
    {
        return ['id' => $c->id, 'title' => $c->title, 'version' => $c->version, 'busy_until' => $c->busy_until?->toISOString(), 'created_at' => $c->created_at->toISOString(), 'updated_at' => $c->updated_at->toISOString()];
    }

    /** @param list<array<string,mixed>> $context */
    public function begin(User $user, string $id, string $requestId, string $prompt, array $context): Turn
    {
        $this->access->authorize($user);

        return DB::transaction(function () use ($user, $id, $requestId, $prompt, $context): Turn {
            $conversation = $this->owned($user)->lockForUpdate()->findOrFail($id);
            app(TurnRecovery::class)->recover($conversation);
            $existing = Message::query()->where('conversation_id', $id)->where('request_id', $requestId)->where('role', 'assistant')->first();
            if ($existing !== null) {
                $original = Message::query()->where('conversation_id', $id)->where('request_id', $requestId)->where('role', 'user')->firstOrFail();
                if ($original->content !== $this->privacy->text($prompt) || $original->context !== $context) {
                    throw new AssistantException('ASSISTANT_REQUEST_CONFLICT', 'This request ID was already used for another message.');
                }
                if ($existing->status === MessageStatus::Processing) {
                    throw new AssistantException('ASSISTANT_BUSY', 'This message is already processing.');
                }

                return new Turn($conversation, $existing, null, null, '');
            }
            if ($conversation->busy_until?->isFuture()) {
                throw new AssistantException('ASSISTANT_BUSY', 'Another message is processing.');
            }
            if (ToolCall::query()->where('conversation_id', $id)->where('status', ToolStatus::Pending->value)->exists()) {
                throw new AssistantException('ASSISTANT_APPROVAL_PENDING', 'Resolve the pending draft approvals before sending another message.');
            }
            $reservation = $this->budget->reserve($user);
            $lease = (string) Str::uuid7();
            $conversation->update(['lease_token' => $lease, 'busy_until' => now()->addSeconds(max(1800, (int) config('assistant.lease_seconds', 1800)))]);
            $base = ['conversation_id' => $id, 'company_id' => $conversation->company_id, 'user_id' => $user->id, 'request_id' => $requestId, 'sdk_messages' => [], 'context' => []];
            $safe = $this->privacy->text($prompt);
            Message::query()->create([...$base, 'role' => 'user', 'status' => MessageStatus::Completed, 'content' => $safe, 'context' => $context]);
            $message = Message::query()->create([...$base, 'role' => 'assistant', 'status' => MessageStatus::Processing, 'content' => '', 'usage_id' => $reservation['id'], 'reserved_tokens' => $reservation['tokens'], 'reservation_settled' => false]);

            return new Turn($conversation, $message, $lease, $reservation, ConversationHistory::withContext($safe, $context));
        });
    }

    /** @param Closure(string,array<string,mixed>):void $emit */
    public function run(User $user, Turn $turn, Closure $emit): void
    {
        if ($turn->lease === null || $turn->reservation === null) {
            $emit('done', ['conversation' => $this->detail($turn->conversation)]);

            return;
        }
        $emit('start', ['conversation_id' => $turn->conversation->id, 'message_id' => $turn->message->id]);
        $input = 0;
        $output = 0;
        $failed = true;
        $audit = app(ToolAudit::class);
        try {
            $this->access->authorize($user);
            $history = app(ConversationHistory::class)->load($turn->conversation, $turn->message->request_id);
            $agent = new ErpAssistant($user, $history);
            $audit->message = $turn->message;
            $response = $agent->prompt($turn->prompt, provider: (string) config('assistant.provider'), model: (string) config('assistant.model'), timeout: (int) config('assistant.timeout', 90));
            $input = $response->usage->inputTokens;
            $output = $response->usage->outputTokens;
            $this->access->authorize($user);
            DB::transaction(function () use ($turn, $response, $user): void {
                $conversation = $this->owned($user)->lockForUpdate()->findOrFail($turn->conversation->id);
                if ($conversation->lease_token !== $turn->lease) {
                    throw new AssistantException('ASSISTANT_BUSY', 'The processing lease has expired.');
                }
                $this->complete($turn->message, $response, $user);
                app(TurnRecovery::class)->settle($turn->message, $response->usage->inputTokens, $response->usage->outputTokens, false);
                $conversation->update(['version' => $conversation->version + 1, 'lease_token' => null, 'busy_until' => null]);
            });
            $failed = false;
            // Privacy filtering happens before any text crosses the SSE boundary. Token fragments
            // cannot safely be masked independently because identifiers may span multiple fragments.
            $turn->message->refresh();
            foreach (mb_str_split($turn->message->content, 160) as $text) {
                $emit('delta', ['text' => $text]);
            }
            foreach (ToolCall::query()->where('message_id', $turn->message->id)->where('status', ToolStatus::Pending->value)->get() as $call) {
                $emit('tool_approval', ['id' => $call->id, 'tool' => $call->tool, 'arguments' => $call->preview, 'reason' => $call->reason]);
            }
            $emit('done', ['conversation' => $this->detail($turn->conversation->refresh())]);
        } catch (Throwable $exception) {
            $turn->message->update(['status' => MessageStatus::Failed, 'content' => (string) __('assistant::messages.failed')]);
            $this->owned($user)->whereKey($turn->conversation->id)->where('lease_token', $turn->lease)->update(['lease_token' => null, 'busy_until' => null]);
            $emit('error', ['code' => $exception instanceof AssistantException ? $exception->errorCode : 'ASSISTANT_PROVIDER_ERROR', 'message' => (string) __('assistant::messages.failed')]);
        } finally {
            $audit->message = null;
            app(TurnRecovery::class)->settle($turn->message, $input, $output, $failed);
        }
    }

    private function complete(Message $message, AgentResponse $response, User $user): void
    {
        $tools = [];
        foreach (app(ToolRegistry::class)->forUser($user) as $tool) {
            $tools[$tool->name()] = $tool;
        }
        if ($response->pendingApprovals->count() > 8 || strlen((string) json_encode($response->pendingApprovals->toArray())) > 65536) {
            throw new AssistantException('ASSISTANT_TOOL_LIMIT', 'Too many draft approvals were requested.', 422);
        }
        foreach ($response->pendingApprovals as $approval) {
            if (strlen((string) json_encode($approval->arguments)) > 16384) {
                throw new AssistantException('ASSISTANT_TOOL_LIMIT', 'The draft arguments exceed the preview limit.', 422);
            }
            $tool = $tools[$approval->tool] ?? null;
            if ($tool === null || $tool->kind() !== 'draft') {
                throw new AssistantException('ASSISTANT_TOOL_UNAVAILABLE', 'This draft tool is no longer available.', 403);
            }
            ToolCall::query()->create([
                'message_id' => $message->id, 'conversation_id' => $message->conversation_id, 'company_id' => $message->company_id, 'user_id' => $message->user_id,
                'provider_call_id' => $approval->id, 'tool' => $approval->tool, 'kind' => 'draft', 'status' => ToolStatus::Pending,
                'arguments' => $approval->arguments, 'preview' => $this->privacy->data($approval->arguments), 'reason' => mb_substr($this->privacy->text($approval->reason ?? (string) __('assistant::messages.approval_reason')), 0, 500),
            ]);
        }
        $message->update(['content' => mb_substr($this->privacy->text($response->text), 0, (int) config('assistant.max_output_chars', 16000)), 'status' => $response->hasPendingApprovals() ? MessageStatus::PendingApproval : MessageStatus::Completed]);
    }

    public function decide(User $user, string $id, string $callId, bool $approve): Conversation
    {
        $this->access->authorize($user);
        try {
            return DB::transaction(function () use ($user, $id, $callId, $approve): Conversation {
                $conversation = $this->owned($user)->lockForUpdate()->findOrFail($id);
                if ($conversation->busy_until?->isFuture()) {
                    throw new AssistantException('ASSISTANT_BUSY', 'Another message is processing.');
                }
                $call = ToolCall::query()->where('conversation_id', $id)->where('company_id', $conversation->company_id)->where('user_id', $user->id)->lockForUpdate()->findOrFail($callId);
                $expected = $approve ? ToolStatus::Completed : ToolStatus::Rejected;
                if ($call->status !== ToolStatus::Pending) {
                    if ($call->status !== $expected) {
                        throw new AssistantException('ASSISTANT_APPROVAL_RESOLVED', 'This approval has already been resolved.');
                    }

                    return $conversation;
                }
                $result = ['message' => (string) __('assistant::messages.rejected')];
                if ($approve) {
                    $tools = app(ToolRegistry::class)->forUser($user);
                    $tool = collect($tools)->first(fn ($candidate): bool => $candidate->name() === $call->tool && $candidate->kind() === 'draft');
                    if ($tool === null) {
                        throw new AssistantException('ASSISTANT_TOOL_UNAVAILABLE', 'You no longer have permission to create this draft.', 403);
                    }
                    $value = app(ToolExecutionContext::class)->withApprovedCalls([$call->provider_call_id], fn (): string => (string) $tool->handle(new Request($call->arguments, $call->provider_call_id)));
                    $result = json_decode($value, true, flags: JSON_THROW_ON_ERROR);
                }
                $call->update(['status' => $expected, 'result' => $this->privacy->data($result), 'resolved_at' => now()]);
                if (! ToolCall::query()->where('message_id', $call->message_id)->where('status', ToolStatus::Pending->value)->exists()) {
                    Message::query()->whereKey($call->message_id)->update(['status' => MessageStatus::Completed->value]);
                }
                $conversation->update(['version' => $conversation->version + 1]);

                return $conversation;
            });
        } catch (Throwable $exception) {
            $call = ToolCall::query()->where('conversation_id', $id)->where('company_id', $this->context->id())->where('user_id', $user->id)->find($callId);
            if ($call !== null && $call->status === ToolStatus::Pending) {
                ToolCall::query()->create([
                    'message_id' => $call->message_id, 'conversation_id' => $id, 'company_id' => $call->company_id, 'user_id' => $user->id,
                    'provider_call_id' => 'attempt:'.Str::uuid7(), 'tool' => $call->tool, 'kind' => $call->kind, 'status' => ToolStatus::Failed,
                    'arguments' => $call->arguments, 'preview' => $call->preview, 'result' => ['state' => 'failed', 'approval_id' => $callId, 'message' => 'The approval could not be executed.'], 'resolved_at' => now(),
                ]);
            }
            throw $exception;
        }
    }
}
