<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasStatus;
use App\Core\Documents\HasVersion;
use App\Core\Documents\InteractsWithStatus;
use App\Core\Money\DecimalCast;
use App\Core\Support\HasUuid7;
use App\Modules\Files\Contracts\Attachable;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\RequestStatus;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * Internal purchase request (what is needed, how much, by when); estimated_total is in company
 * currency. Approved requests are turned into RFQs or orders.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property RequestStatus $status
 * @property Carbon $document_date
 * @property Carbon|null $needed_by
 * @property string|null $requested_by
 * @property string|null $warehouse_id
 * @property string|null $cost_center_id
 * @property string|null $project_id
 * @property string $currency_code
 * @property string|null $notes
 * @property string|null $internal_notes
 * @property BigDecimal $estimated_total
 * @property string|null $approval_request_id
 * @property string|null $approval_comment
 * @property Carbon|null $submitted_at
 * @property Carbon|null $approved_at
 * @property Carbon|null $rejected_at
 * @property Carbon|null $cancelled_at
 * @property int $version
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Collection<int, PurchaseRequestLine> $lines
 */
class PurchaseRequest extends Model implements Attachable, HasStatus
{
    use BelongsToCompany;
    use HasUuid7;
    use HasVersion;
    use InteractsWithStatus;
    use LogsActivity;

    protected $table = 'purchase_requests';

    /** @var list<string> */
    protected $guarded = ['id', 'company_id', 'version'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft'];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Request;
    }

    /** @return HasMany<PurchaseRequestLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseRequestLine::class, 'document_id')->orderBy('line_no');
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['number', 'status', 'document_date', 'needed_by', 'estimated_total', 'notes', 'version'])
            ->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => RequestStatus::class, 'document_date' => 'date', 'needed_by' => 'date', 'estimated_total' => DecimalCast::class.':4',
            'submitted_at' => 'datetime', 'approved_at' => 'datetime', 'rejected_at' => 'datetime', 'cancelled_at' => 'datetime',
        ];
    }
}
