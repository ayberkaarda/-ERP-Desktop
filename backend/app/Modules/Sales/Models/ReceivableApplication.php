<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Money\DecimalCast;
use App\Core\Support\HasUuid7;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * A settlement applied to an invoice by reference (Phase 7 treasury); one per invoice and reference.
 *
 * @property string $id
 * @property string $company_id
 * @property string $invoice_id
 * @property string $reference
 * @property BigDecimal $amount
 * @property Carbon $applied_at
 * @property Carbon|null $unapplied_at
 * @property string|null $created_by
 */
class ReceivableApplication extends Model
{
    use BelongsToCompany;
    use HasUuid7;
    use LogsActivity;

    protected $table = 'sales_receivable_applications';

    /** @var list<string> */
    protected $guarded = ['id', 'company_id'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['invoice_id', 'reference', 'amount', 'unapplied_at'])->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['amount' => DecimalCast::class.':4', 'applied_at' => 'datetime', 'unapplied_at' => 'datetime'];
    }
}
