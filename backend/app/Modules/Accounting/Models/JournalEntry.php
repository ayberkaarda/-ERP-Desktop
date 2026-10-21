<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Models;

use App\Core\Documents\HasVersion;
use App\Core\Money\MoneyCast;
use App\Modules\Accounting\Enums\EntryStatus;
use App\Modules\Accounting\Enums\EntryType;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Journal entry (yevmiye maddesi). Drafts are free to change; posted entries are immutable
 * (database triggers) and are corrected only by a reversal.
 *
 * @property string|null $number
 * @property EntryType $entry_type
 * @property Carbon $entry_date
 * @property string $period_id
 * @property string $fiscal_year_id
 * @property string|null $description
 * @property EntryStatus $status
 * @property string|null $source_type
 * @property string|null $source_id
 * @property string|null $posting_key
 * @property string|null $reverses_id
 * @property string|null $reversed_by_id
 * @property string|null $reversal_reason
 * @property Carbon|null $posted_at
 * @property string|null $posted_by
 * @property string|null $created_by
 * @property BigDecimal $total_debit
 * @property BigDecimal $total_credit
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Collection<int, JournalLine> $lines
 * @property-read AccountingPeriod $period
 */
class JournalEntry extends AccountingModel
{
    use HasVersion;

    public const int MAX_LINES = 500;

    public const array FIELDS = ['number', 'entry_type', 'entry_date', 'period_id', 'description', 'status', 'reversed_by_id', 'total_debit', 'total_credit'];

    /** @var list<string> */
    protected $fillable = ['entry_type', 'entry_date', 'description'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft', 'total_debit' => '0', 'total_credit' => '0'];

    public function getMorphClass(): string
    {
        return 'journal_entry';
    }

    public function isDraft(): bool
    {
        return $this->status === EntryStatus::Draft;
    }

    /** @return HasMany<JournalLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class, 'entry_id')->orderBy('line_no');
    }

    /** @return BelongsTo<AccountingPeriod, $this> */
    public function period(): BelongsTo
    {
        return $this->belongsTo(AccountingPeriod::class, 'period_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'entry_type' => EntryType::class,
            'entry_date' => 'date',
            'status' => EntryStatus::class,
            'posted_at' => 'datetime',
            'total_debit' => MoneyCast::class,
            'total_credit' => MoneyCast::class,
        ];
    }
}
