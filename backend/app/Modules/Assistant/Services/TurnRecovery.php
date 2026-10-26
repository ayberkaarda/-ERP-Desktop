<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Services;

use App\Modules\Assistant\Enums\MessageStatus;
use App\Modules\Assistant\Models\Conversation;
use App\Modules\Assistant\Models\Message;
use Illuminate\Support\Facades\DB;

final readonly class TurnRecovery
{
    public function __construct(private TokenBudget $budget) {}

    public function settle(Message $message, int $input, int $output, bool $failed): void
    {
        DB::transaction(function () use ($message, $input, $output, $failed): void {
            $record = Message::query()->lockForUpdate()->findOrFail($message->id);
            if ($record->reservation_settled || $record->usage_id === null) {
                return;
            }
            $this->budget->settle(['id' => $record->usage_id, 'tokens' => $record->reserved_tokens], $input, $output, $failed);
            $record->update(['reservation_settled' => true]);
        });
    }

    public function recover(Conversation $conversation): void
    {
        if ($conversation->busy_until?->isFuture()) {
            return;
        }
        foreach (Message::query()->where('conversation_id', $conversation->id)->where('reservation_settled', false)->get() as $message) {
            $this->settle($message, 0, 0, true);
            if ($message->status === MessageStatus::Processing) {
                $message->update(['status' => MessageStatus::Failed, 'content' => (string) __('assistant::messages.interrupted')]);
            }
        }
    }
}
