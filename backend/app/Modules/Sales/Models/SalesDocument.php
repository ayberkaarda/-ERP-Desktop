<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasStatus;
use App\Core\Documents\HasVersion;
use App\Core\Documents\InteractsWithStatus;
use App\Core\Money\DecimalCast;
use App\Core\Support\HasUuid7;
use App\Modules\Files\Contracts\Attachable;
use App\Modules\Sales\Enums\DocumentKind;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * Common header of the sales documents: party snapshot, currency, dimensions, link to the source
 * document and totals in document and company currency. Company scoped, versioned and audited.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property Carbon $document_date
 * @property string $party_id
 * @property string $party_name
 * @property string|null $party_tax_office
 * @property string|null $party_tax_number
 * @property array<string, mixed>|null $billing_address
 * @property string $currency_code
 * @property BigDecimal $fx_rate
 * @property string|null $payment_term_id
 * @property Carbon|null $due_date
 * @property string|null $price_list_id
 * @property string|null $warehouse_id
 * @property string|null $cost_center_id
 * @property string|null $project_id
 * @property string|null $notes
 * @property string|null $internal_notes
 * @property string|null $source_type
 * @property string|null $source_id
 * @property BigDecimal $subtotal
 * @property BigDecimal $discount_total
 * @property BigDecimal $tax_total
 * @property BigDecimal $total
 * @property BigDecimal $subtotal_local
 * @property BigDecimal $discount_total_local
 * @property BigDecimal $tax_total_local
 * @property BigDecimal $total_local
 * @property int $version
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Collection<int, SalesLine> $lines
 */
abstract class SalesDocument extends Model implements Attachable, HasStatus
{
    use BelongsToCompany;
    use HasUuid7;
    use HasVersion;
    use InteractsWithStatus;
    use LogsActivity;

    public const int MAX_LINES = 500;

    /** Header columns a client may set on a draft (the services decide the rest). */
    public const array HEADER = [
        'document_date', 'party_id', 'currency_code', 'fx_rate', 'payment_term_id', 'due_date', 'price_list_id', 'warehouse_id',
        'cost_center_id', 'project_id', 'notes', 'internal_notes',
    ];

    public const array TOTALS = [
        'subtotal', 'discount_total', 'tax_total', 'total', 'subtotal_local', 'discount_total_local', 'tax_total_local', 'total_local',
    ];

    /** @var list<string> */
    protected $guarded = ['id', 'company_id', 'version'];

    abstract public static function kind(): DocumentKind;

    /** @return class-string<SalesLine> */
    abstract public static function lineClass(): string;

    /** @return HasMany<covariant SalesLine, $this> */
    abstract public function lines(): HasMany;

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()
            ->logOnly(['number', 'status', 'document_date', 'party_id', 'currency_code', 'fx_rate', 'total', 'total_local', 'notes', 'version'])
            ->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        $casts = [
            'document_date' => 'date',
            'due_date' => 'date',
            'billing_address' => 'array',
            'fx_rate' => DecimalCast::class,
        ];

        foreach (self::TOTALS as $column) {
            $casts[$column] = DecimalCast::class.':4';
        }

        return [...$casts, ...$this->extraCasts()];
    }

    /** @return array<string, string> */
    protected function extraCasts(): array
    {
        return [];
    }
}
