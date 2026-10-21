<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Money\DecimalCast;
use App\Core\Money\MoneyCast;
use App\Core\Support\HasUuid7;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Written in bulk by the ledger services and audited through its entry, so no activity log here.
 *
 * @property string $id
 * @property string $company_id
 * @property string $entry_id
 * @property int $line_no
 * @property string $account_id
 * @property BigDecimal $debit
 * @property BigDecimal $credit
 * @property string|null $currency_code
 * @property BigDecimal|null $fx_amount
 * @property BigDecimal|null $fx_rate
 * @property string|null $party_id
 * @property string|null $cost_center_id
 * @property string|null $project_id
 * @property string|null $description
 * @property Carbon|null $due_date
 * @property string|null $document_ref
 * @property-read Account $account
 * @property-read JournalEntry $entry
 */
class JournalLine extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    /** Columns a line carries besides its keys. */
    public const array COLUMNS = [
        'line_no', 'account_id', 'debit', 'credit', 'currency_code', 'fx_amount', 'fx_rate',
        'party_id', 'cost_center_id', 'project_id', 'description', 'due_date', 'document_ref',
    ];

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = self::COLUMNS;

    /** @return BelongsTo<Account, $this> */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /** @return BelongsTo<JournalEntry, $this> */
    public function entry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'entry_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'line_no' => 'integer',
            'debit' => MoneyCast::class,
            'credit' => MoneyCast::class,
            'fx_amount' => MoneyCast::class,
            'fx_rate' => DecimalCast::class,
            'due_date' => 'date',
        ];
    }
}
