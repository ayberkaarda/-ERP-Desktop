<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Services;

use App\Modules\Assistant\Contracts\ErpTool;
use App\Modules\Assistant\Enums\ToolStatus;
use App\Modules\Assistant\Exceptions\AssistantException;
use App\Modules\Assistant\Models\Message;
use App\Modules\Assistant\Models\ToolCall;
use Laravel\Ai\Events\InvokingTool;
use Laravel\Ai\Events\ToolFailed;
use Laravel\Ai\Events\ToolInvoked;

final class ToolAudit
{
    public ?Message $message = null;

    public function invoking(InvokingTool $event): void
    {
        if ($this->message === null || ! $event->tool instanceof ErpTool) {
            return;
        }
        if (ToolCall::query()->where('message_id', $this->message->id)->count() >= 32 || strlen((string) json_encode($event->arguments)) > 16384) {
            throw new AssistantException('ASSISTANT_TOOL_LIMIT', 'The assistant tool limit was reached.', 422);
        }
        ToolCall::query()->create([
            'message_id' => $this->message->id, 'conversation_id' => $this->message->conversation_id,
            'company_id' => $this->message->company_id, 'user_id' => $this->message->user_id,
            'provider_call_id' => $event->toolInvocationId, 'tool' => $event->tool->name(), 'kind' => $event->tool->kind(),
            'status' => ToolStatus::Completed, 'arguments' => $event->arguments,
            'preview' => app(PrivacyFilter::class)->data($event->arguments), 'result' => ['state' => 'invoked'],
        ]);
    }

    public function invoked(ToolInvoked $event): void
    {
        $this->finish($event->toolInvocationId, app(PrivacyFilter::class)->data($event->result));
    }

    public function failed(ToolFailed $event): void
    {
        $this->finish($event->toolInvocationId, ['state' => 'failed', 'message' => 'The tool could not be executed.']);
        if ($this->message !== null) {
            ToolCall::query()->where('message_id', $this->message->id)->where('provider_call_id', $event->toolInvocationId)->update(['status' => ToolStatus::Failed->value]);
        }
    }

    private function finish(string $id, mixed $result): void
    {
        if ($this->message === null) {
            return;
        }
        $row = ToolCall::query()->where('message_id', $this->message->id)->where('provider_call_id', $id)->first();
        $row?->update(['result' => $result, 'resolved_at' => now()]);
    }
}
