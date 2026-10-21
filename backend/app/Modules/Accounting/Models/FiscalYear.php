<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Accounting\Enums\FiscalYearStatus;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property string $code
 * @property string $name
 * @property Carbon $start_date
 * @property Carbon $end_date
 * @property FiscalYearStatus $status
 * @property Carbon|null $closed_at
 * @property string|null $closed_by
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Collection<int, AccountingPeriod> $periods
 */
class FiscalYear extends AccountingModel
{
    use HasVersion;

    public const array FIELDS = ['code', 'name', 'start_date', 'end_date', 'status'];

    /** @var list<string> */
    protected $fillable = ['code', 'name', 'start_date', 'end_date'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'open'];

    public function getMorphClass(): string
    {
        return 'fiscal_year';
    }

    /** Integer year used for numbering sequences: the code when it is a year, else the start year. */
    public function sequenceYear(): int
    {
        return preg_match('/^\d{4}$/', $this->code) === 1 ? (int) $this->code : (int) $this->start_date->format('Y');
    }

    public function isOpen(): bool
    {
        return $this->status === FiscalYearStatus::Open;
    }

    /** @return HasMany<AccountingPeriod, $this> */
    public function periods(): HasMany
    {
        return $this->hasMany(AccountingPeriod::class)->orderBy('number');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'end_date' => 'date',
            'status' => FiscalYearStatus::class,
            'closed_at' => 'datetime',
        ];
    }
}
