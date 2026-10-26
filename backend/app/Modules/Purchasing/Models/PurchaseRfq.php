<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasStatus;
use App\Core\Documents\HasVersion;
use App\Core\Documents\InteractsWithStatus;
use App\Core\Support\HasUuid7;
use App\Modules\Files\Contracts\Attachable;
use App\Modules\Purchasing\Enums\DocumentKind;
use App\Modules\Purchasing\Enums\RfqStatus;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * Request for quotation sent to several suppliers; their quotes are entered per line in the RFQ
 * currency and the award turns the chosen quotes into draft orders.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property RfqStatus $status
 * @property Carbon $document_date
 * @property Carbon|null $response_due
 * @property string|null $request_id
 * @property string $currency_code
 * @property string|null $warehouse_id
 * @property string|null $notes
 * @property string|null $internal_notes
 * @property Carbon|null $sent_at
 * @property Carbon|null $awarded_at
 * @property string|null $awarded_by
 * @property Carbon|null $cancelled_at
 * @property int $version
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Collection<int, PurchaseRfqLine> $lines
 * @property-read Collection<int, RfqSupplier> $suppliers
 * @property-read Collection<int, RfqQuote> $quotes
 */
class PurchaseRfq extends Model implements Attachable, HasStatus
{
    use BelongsToCompany;
    use HasUuid7;
    use HasVersion;
    use InteractsWithStatus;
    use LogsActivity;

    protected $table = 'purchase_rfqs';

    /** @var list<string> */
    protected $guarded = ['id', 'company_id', 'version'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'draft'];

    public static function kind(): DocumentKind
    {
        return DocumentKind::Rfq;
    }

    /** @return HasMany<PurchaseRfqLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseRfqLine::class, 'document_id')->orderBy('line_no');
    }

    /** @return HasMany<RfqSupplier, $this> */
    public function suppliers(): HasMany
    {
        return $this->hasMany(RfqSupplier::class, 'rfq_id')->orderBy('party_name')->orderBy('id');
    }

    /** @return HasMany<RfqQuote, $this> */
    public function quotes(): HasMany
    {
        return $this->hasMany(RfqQuote::class, 'rfq_id');
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['number', 'status', 'document_date', 'response_due', 'currency_code', 'notes', 'version'])
            ->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => RfqStatus::class, 'document_date' => 'date', 'response_due' => 'date', 'sent_at' => 'datetime',
            'awarded_at' => 'datetime', 'cancelled_at' => 'datetime',
        ];
    }
}
