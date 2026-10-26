<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Console;

use App\Core\Company\CompanyContext;
use App\Modules\Assistant\Models\Conversation;
use App\Modules\Assistant\Services\TurnRecovery;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class PruneConversations extends Command
{
    protected $signature = 'assistant:prune';

    protected $description = 'Remove expired assistant conversations and their messages and tool records.';

    public function handle(): int
    {
        $days = max(1, (int) config('assistant.retention_days', 30));
        $count = 0;
        Conversation::withoutCompanyScope()->where('updated_at', '<', now()->subDays($days))->orderBy('id')->chunkById(100, function ($rows) use (&$count): void {
            foreach ($rows as $row) {
                DB::transaction(function () use ($row, &$count): void {
                    $record = Conversation::withoutCompanyScope()->lockForUpdate()->find($row->id);
                    if ($record === null || $record->busy_until?->isFuture() || $record->updated_at->isAfter(now()->subDays(max(1, (int) config('assistant.retention_days', 30))))) {
                        return;
                    }
                    app(CompanyContext::class)->runAs($record->company_id, function () use ($record): void {
                        app(TurnRecovery::class)->recover($record);
                        $record->delete();
                    });
                    $count++;
                });
            }
        });
        $this->info('Removed '.$count.' expired conversations.');

        return self::SUCCESS;
    }
}
