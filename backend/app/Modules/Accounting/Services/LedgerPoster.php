<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Core\Company\CompanyContext;
use App\Core\Numbering\NumberSequenceService;
use App\Modules\Accounting\Contracts\PostingService;
use App\Modules\Accounting\Data\PostedEntry;
use App\Modules\Accounting\Data\PostingRequest;
use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Events\EntryPosted;
use App\Modules\Accounting\Events\EntryReversed;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\LineInput;
use App\Modules\Accounting\Support\Messages;
use Brick\Math\BigDecimal;
use DateTimeInterface;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Books journal entries. Every booking (documents of other modules, manual drafts, reversals,
 * closing and revaluation entries) ends in finalize(): number from the gapless journal sequence
 * of the fiscal year, status posted, balances updated and the deferred balance check fired, all
 * in the caller's transaction; EntryPosted is dispatched after commit.
 */
final class LedgerPoster implements PostingService
{
    public const string DOC_TYPE = 'journal';

    /** Default journal number format, e.g. 2027-000001; deployments may configure their own. */
    public const string FORMAT = '{year}-{seq:6}';

    public const string REVERSAL_SOURCE = 'journal_entry';

    public function __construct(
        private readonly CompanyContext $company,
        private readonly Periods $periods,
        private readonly LineBuilder $lines,
        private readonly BalanceBook $balances,
        private readonly NumberSequenceService $numbers,
    ) {}

    public function post(PostingRequest $request): PostedEntry
    {
        return $this->company->runAs($request->companyId, fn (): PostedEntry => Ledger::transaction(function () use ($request): PostedEntry {
            $key = $request->postingKey();

            if ($key !== null) {
                // Serializes identical requests; the partial unique index is the second line of defence.
                Ledger::lock('post.'.hash('sha256', $key));
                $existing = JournalEntry::query()->where('posting_key', $key)->where('status', '<>', EntryStatus::Draft->value)->first();

                if ($existing !== null) {
                    return PostedEntry::of($existing, true);
                }
            }

            $generated = self::generated($request->entryType, $request->sourceType);
            $lines = $this->lines->build(LineBuilder::fromPostingLines($request->lines), requireActive: ! $generated);

            $entry = $this->book($lines, [
                'entry_type' => $request->entryType,
                'entry_date' => $request->entryDate->format('Y-m-d'),
                'description' => $request->description,
                'source_type' => $request->sourceType,
                'source_id' => $request->sourceId,
                'posting_key' => $key,
            ], $request->postedBy, $request->allowSoftClosed, $request->periodId, strict: ! $generated);

            return PostedEntry::of($entry);
        }));
    }

    public function reverse(string $entryId, DateTimeInterface $date, string $reason): PostedEntry
    {
        $actor = Auth::id();

        return PostedEntry::of($this->reverseEntry($entryId, $date, $reason, is_string($actor) ? $actor : null));
    }

    /**
     * @param  bool  $allowGenerated  only the year-end procedure may reverse its own entries
     */
    public function reverseEntry(
        string $entryId,
        DateTimeInterface $date,
        string $reason,
        ?string $actor,
        bool $allowGenerated = false,
        bool $allowSoftClosed = false,
        ?string $periodId = null,
    ): JournalEntry {
        return Ledger::transaction(function () use ($entryId, $date, $reason, $actor, $allowGenerated, $allowSoftClosed, $periodId): JournalEntry {
            $original = JournalEntry::query()->whereKey(Str::isUuid($entryId) ? $entryId : null)->lockForUpdate()->firstOrFail();
            $reason = trim($reason);

            if ($original->status !== EntryStatus::Posted) {
                Messages::fail('entry', $original->status === EntryStatus::Reversed ? 'entry_already_reversed' : 'entry_not_posted');
            }

            if (! $allowGenerated && $original->source_type === YearEndClosing::SOURCE) {
                Messages::fail('entry', 'generated_entry_locked');
            }

            if ($reason === '' || mb_strlen($reason) > 1000) {
                Messages::fail('reason', 'reason_required');
            }

            $lines = array_map(static fn (LineInput $l): LineInput => $l->mirrored(), LineBuilder::fromEntry($original));

            $reversal = $this->book($lines, [
                'entry_type' => EntryType::Reversal,
                'entry_date' => $date->format('Y-m-d'),
                'description' => $original->description,
                'source_type' => $original->source_type,
                'source_id' => $original->source_id,
                'posting_key' => self::REVERSAL_SOURCE.'|'.$original->id.'|reversal',
                'reverses_id' => $original->id,
                'reversal_reason' => $reason,
            ], $actor, $allowSoftClosed, $periodId, strict: false);

            $original->status = EntryStatus::Reversed;
            $original->reversed_by_id = $reversal->id;
            $original->save();

            event(new EntryReversed($original->company_id, $original->id, $reversal->id, $original->source_type, $original->source_id));

            return $reversal;
        });
    }

    /**
     * Books a stored draft after re-validating it under a row lock.
     */
    public function postDraft(JournalEntry $draft, ?string $actor, bool $allowSoftClosed, ?int $version = null): JournalEntry
    {
        return Ledger::transaction(function () use ($draft, $actor, $allowSoftClosed, $version): JournalEntry {
            $entry = JournalEntry::query()->whereKey($draft->id)->lockForUpdate()->firstOrFail();

            if ($version !== null) {
                $entry->assertVersion($version);
            }

            if (! $entry->isDraft()) {
                Messages::fail('entry', 'entry_not_draft');
            }

            $lines = LineBuilder::fromEntry($entry);

            foreach ($lines as $i => $line) {
                if (! $line->account->is_active) {
                    Messages::fail("lines.{$i}.account_id", 'account_inactive', ['code' => $line->account->code]);
                }
            }

            [$debit, $credit] = $this->lines->assertBookable($lines, strict: true);
            $period = AccountingPeriod::query()->with('fiscalYear')->whereKey($entry->period_id)->sharedLock()->firstOrFail();
            $this->periods->assertPostable($period, $allowSoftClosed);

            return $this->finalize($entry, $period, $actor, $allowSoftClosed, $debit, $credit);
        });
    }

    /**
     * Writes a new entry with its lines and books it.
     *
     * @param  list<LineInput>  $lines
     * @param  array<string, mixed>  $attributes
     */
    public function book(array $lines, array $attributes, ?string $actor, bool $allowSoftClosed, ?string $periodId, bool $strict): JournalEntry
    {
        [$debit, $credit] = $this->lines->assertBookable($lines, $strict);
        $date = $attributes['entry_date'];
        $period = $this->periods->forDate(new \DateTimeImmutable(is_string($date) ? $date : 'now'), $periodId, lock: true);
        $this->periods->assertPostable($period, $allowSoftClosed);

        $entry = new JournalEntry;
        $entry->forceFill([
            ...$attributes,
            'id' => (string) Str::uuid7(),
            'period_id' => $period->id,
            'fiscal_year_id' => $period->fiscal_year_id,
            'status' => EntryStatus::Draft,
            'created_by' => $actor,
            'total_debit' => $debit,
            'total_credit' => $credit,
        ]);
        $entry->save();
        $this->writeLines($entry, $lines);

        return $this->finalize($entry, $period, $actor, $allowSoftClosed, $debit, $credit);
    }

    /**
     * Replaces the lines of a draft entry.
     *
     * @param  list<LineInput>  $lines
     */
    public function writeLines(JournalEntry $entry, array $lines): void
    {
        DB::table('journal_lines')->where('entry_id', $entry->id)->delete();
        $rows = [];

        foreach ($lines as $i => $line) {
            $rows[] = $line->row($entry->company_id, $entry->id, $i + 1, (string) Str::uuid7());
        }

        foreach (array_chunk($rows, 250) as $chunk) {
            DB::table('journal_lines')->insert($chunk);
        }
    }

    private function finalize(JournalEntry $entry, AccountingPeriod $period, ?string $actor, bool $allowSoftClosed, BigDecimal $debit, BigDecimal $credit): JournalEntry
    {
        Ledger::allowSoftClosed($allowSoftClosed);

        $entry->number = $this->numbers->next($entry->company_id, self::DOC_TYPE, null, $period->fiscalYear->sequenceYear());
        $entry->status = EntryStatus::Posted;
        $entry->posted_at = now();
        $entry->posted_by = $actor;
        $entry->total_debit = $debit;
        $entry->total_credit = $credit;
        $entry->save();

        $this->balances->apply($entry->company_id, $entry->id, $entry->period_id);
        Ledger::checkBalances();
        Ledger::allowSoftClosed(false);

        event(new EntryPosted($entry->company_id, $entry->id, (string) $entry->number, $entry->entry_type->value, $entry->source_type, $entry->source_id));

        return $entry;
    }

    /** Entries the ledger builds itself carry aggregated lines without document dimensions. */
    private static function generated(EntryType $type, ?string $sourceType): bool
    {
        return in_array($type, [EntryType::Closing, EntryType::Revaluation, EntryType::Reversal], true)
            || $sourceType === YearEndClosing::SOURCE;
    }
}
