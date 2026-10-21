<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Accounting\Enums\PeriodStatus;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property string $fiscal_year_id
 * @property int $number
 * @property Carbon $start_date
 * @property Carbon $end_date
 * @property PeriodStatus $status
 * @property Carbon|null $closed_at
 * @property string|null $closed_by
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read FiscalYear $fiscalYear
 */
class AccountingPeriod extends AccountingModel
{
    use HasVersion;

    /** Year-end adjustment period. */
    public const int ADJUSTMENT = 13;

    public const array FIELDS = ['number', 'start_date', 'end_date', 'status'];

    /** @var list<string> */
    protected $fillable = ['number', 'start_date', 'end_date'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'open'];

    public function getMorphClass(): string
    {
        return 'accounting_period';
    }

    /** @return BelongsTo<FiscalYear, $this> */
    public function fiscalYear(): BelongsTo
    {
        return $this->belongsTo(FiscalYear::class);
    }

    /** @return HasMany<JournalEntry, $this> */
    public function entries(): HasMany
    {
        return $this->hasMany(JournalEntry::class, 'period_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'number' => 'integer',
            'start_date' => 'date',
            'end_date' => 'date',
            'status' => PeriodStatus::class,
            'closed_at' => 'datetime',
        ];
    }
}
