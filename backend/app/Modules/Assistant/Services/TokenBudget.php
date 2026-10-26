<?php

declare(strict_types=1);

namespace App\Modules\Assistant\Services;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Assistant\Exceptions\AssistantException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final readonly class TokenBudget
{
    public function __construct(private CompanyContext $context) {}

    /** @return array{used_tokens:int,reserved_tokens:int,remaining_tokens:int} */
    public function status(User $user): array
    {
        $totals = DB::table('assistant_usage')->where('user_id', $user->id)->where('date', now('UTC')->toDateString())
            ->selectRaw('coalesce(sum(input_tokens + output_tokens), 0) as used_tokens, coalesce(sum(reserved_tokens), 0) as reserved_tokens')->first();
        $used = (int) ($totals->used_tokens ?? 0);
        $reserved = (int) ($totals->reserved_tokens ?? 0);

        return ['used_tokens' => $used, 'reserved_tokens' => $reserved, 'remaining_tokens' => max(0, (int) config('assistant.daily_tokens') - $used - $reserved)];
    }

    /** @return array{id:string,tokens:int} */
    public function reserve(User $user): array
    {
        return DB::transaction(function () use ($user): array {
            $day = now('UTC')->toDateString();
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['assistant-budget:'.$user->id.':'.$day]);
            $tokens = max(1, (int) config('assistant.turn_tokens'));
            if ($this->status($user)['remaining_tokens'] < $tokens) {
                throw new AssistantException('ASSISTANT_BUDGET_EXCEEDED', 'Your daily assistant token budget is exhausted.', 429);
            }
            $query = DB::table('assistant_usage')->where('company_id', $this->context->id())->where('user_id', $user->id)->where('date', $day);
            $row = $query->first();
            $id = $row === null ? (string) Str::uuid7() : (string) $row->id;
            if ($row === null) {
                DB::table('assistant_usage')->insert(['id' => $id, 'company_id' => $this->context->id(), 'user_id' => $user->id, 'date' => $day, 'reserved_tokens' => $tokens, 'requests' => 1, 'created_at' => now(), 'updated_at' => now()]);
            } else {
                DB::update('UPDATE assistant_usage SET reserved_tokens = reserved_tokens + ?, requests = requests + 1, updated_at = ? WHERE id = ?', [$tokens, now(), $id]);
            }

            return ['id' => $id, 'tokens' => $tokens];
        });
    }

    /** @param array{id:string,tokens:int} $reservation */
    public function settle(array $reservation, int $input, int $output, bool $failed): void
    {
        // A failed/interrupted provider may have incurred unreported usage. Charge the reservation.
        if ($failed) {
            $input = max($input, $reservation['tokens'] - $output);
        }
        DB::transaction(function () use ($reservation, $input, $output, $failed): void {
            $row = DB::table('assistant_usage')->where('id', $reservation['id'])->first();
            if ($row === null) {
                return;
            }
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['assistant-budget:'.$row->user_id.':'.$row->date]);
            DB::update('UPDATE assistant_usage SET reserved_tokens = greatest(0, reserved_tokens - ?), input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, failures = failures + ?, updated_at = ? WHERE id = ?', [$reservation['tokens'], max(0, $input), max(0, $output), $failed ? 1 : 0, now(), $reservation['id']]);
        });
    }
}
