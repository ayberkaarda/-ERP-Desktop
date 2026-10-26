<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Money\DecimalCast;
use App\Core\Support\HasUuid7;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * One supplier's quote for one RFQ line (RFQ currency, line unit).
 *
 * @property string $id
 * @property string $company_id
 * @property string $rfq_id
 * @property string $rfq_line_id
 * @property string $party_id
 * @property BigDecimal $unit_price
 * @property BigDecimal $discount_percent
 * @property int|null $lead_time_days
 * @property Carbon|null $valid_until
 * @property string|null $notes
 */
class RfqQuote extends Model
{
    use BelongsToCompany;
    use HasUuid7;
    use LogsActivity;

    protected $table = 'purchase_rfq_quotes';

    /** @var list<string> */
    protected $guarded = ['id', 'company_id'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['rfq_line_id', 'party_id', 'unit_price', 'discount_percent', 'lead_time_days', 'valid_until'])
            ->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** Unit price after the quoted discount (scale 6). */
    public function netPrice(): BigDecimal
    {
        return $this->unit_price->multipliedBy(BigDecimal::of(100)->minus($this->discount_percent))->dividedBy(100, 6, RoundingMode::HalfUp);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'unit_price' => DecimalCast::class, 'discount_percent' => DecimalCast::class.':4', 'lead_time_days' => 'integer', 'valid_until' => 'date',
        ];
    }
}
