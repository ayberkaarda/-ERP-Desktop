<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Services;

use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Enums\EntryType;
use App\Modules\Accounting\Enums\FiscalYearStatus;
use App\Modules\Accounting\Enums\PeriodStatus;
use App\Modules\Accounting\Models\AccountingPeriod;
use App\Modules\Accounting\Models\JournalEntry;
use App\Modules\Accounting\Support\Ledger;
use App\Modules\Accounting\Support\LineInput;
use App\Modules\Accounting\Support\Messages;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Manual draft entries: may be unbalanced until posted; never in a closed period or year.
 */
final class JournalDrafts
{
    public function __construct(
        private readonly Periods $periods,
        private readonly LineBuilder $lines,
        private readonly LedgerPoster $poster,
    ) {}

    /**
     * @param  array<string, mixed>  $data  entry_type, entry_date, description?, period_id?, lines
     */
    public function create(array $data, ?string $actor): JournalEntry
    {
        return Ledger::transaction(function () use ($data, $actor): JournalEntry {
            $type = $this->type($data['entry_type'] ?? null);
            $period = $this->period($data['entry_date'] ?? null, $data['period_id'] ?? null);
            /** @var list<array<string, mixed>> $raw */
            $raw = is_array($data['lines'] ?? null) ? array_values($data['lines']) : [];
            $lines = $this->lines->build($raw);

            $entry = new JournalEntry;
            $entry->forceFill([
                'id' => (string) Str::uuid7(),
                'entry_type' => $type,
                'entry_date' => $data['entry_date'],
                'description' => $data['description'] ?? null,
                'period_id' => $period->id,
                'fiscal_year_id' => $period->fiscal_year_id,
                'status' => EntryStatus::Draft,
                'created_by' => $actor,
            ]);
            $this->totals($entry, $lines);
            $entry->save();
            $this->poster->writeLines($entry, $lines);

            return $entry;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(JournalEntry $entry, array $data, int $version): JournalEntry
    {
        return Ledger::transaction(function () use ($entry, $data, $version): JournalEntry {
            $locked = $this->lockDraft($entry, $version);

            if (array_key_exists('entry_type', $data)) {
                $locked->entry_type = $this->type($data['entry_type']);
            }

            if (array_key_exists('description', $data)) {
                $locked->description = is_string($data['description']) ? $data['description'] : null;
            }

            if (array_key_exists('entry_date', $data) || array_key_exists('period_id', $data)) {
                $date = $data['entry_date'] ?? $locked->entry_date->format('Y-m-d');
                $period = $this->period($date, $data['period_id'] ?? null);
                $locked->entry_date = Carbon::parse(is_string($date) ? $date : 'now');
                $locked->period_id = $period->id;
                $locked->fiscal_year_id = $period->fiscal_year_id;
            }

            $lines = null;

            if (array_key_exists('lines', $data)) {
                /** @var list<array<string, mixed>> $raw */
                $raw = is_array($data['lines']) ? array_values($data['lines']) : [];
                $lines = $this->lines->build($raw);
                $this->totals($locked, $lines);
            }

            // Always a new version, also when only the lines changed.
            $locked->updated_at = now();
            $locked->save();

            if ($lines !== null) {
                $this->poster->writeLines($locked, $lines);
            }

            return $locked;
        });
    }

    public function delete(JournalEntry $entry, ?int $version): void
    {
        Ledger::transaction(function () use ($entry, $version): void {
            $this->lockDraft($entry, $version)->delete();
        });
    }

    private function lockDraft(JournalEntry $entry, ?int $version): JournalEntry
    {
        $locked = JournalEntry::query()->whereKey($entry->id)->lockForUpdate()->firstOrFail();

        if ($version !== null) {
            $locked->assertVersion($version);
        }

        if (! $locked->isDraft()) {
            Messages::fail('entry', 'entry_not_draft');
        }

        return $locked;
    }

    private function type(mixed $value): EntryType
    {
        $type = is_string($value) ? EntryType::tryFrom($value) : null;

        if ($type === null || ! in_array($type, EntryType::manual(), true)) {
            Messages::fail('entry_type', 'entry_type_manual');
        }

        return $type;
    }

    private function period(mixed $date, mixed $periodId): AccountingPeriod
    {
        if (! is_string($date)) {
            Messages::fail('entry_date', 'no_period_for_date', ['date' => '']);
        }

        $period = $this->periods->forDate(new DateTimeImmutable($date), is_string($periodId) ? $periodId : null);

        if ($period->status === PeriodStatus::Closed || $period->fiscalYear->status === FiscalYearStatus::Closed) {
            Messages::fail('entry_date', $period->status === PeriodStatus::Closed ? 'period_closed' : 'fiscal_year_closed', [
                'period' => $period->number, 'year' => $period->fiscalYear->code,
            ]);
        }

        return $period;
    }

    /**
     * @param  list<LineInput>  $lines
     */
    private function totals(JournalEntry $entry, array $lines): void
    {
        $debit = BigDecimal::zero();
        $credit = BigDecimal::zero();

        foreach ($lines as $line) {
            $debit = $debit->plus($line->debit);
            $credit = $credit->plus($line->credit);
        }

        $entry->total_debit = $debit;
        $entry->total_credit = $credit;
    }
}
