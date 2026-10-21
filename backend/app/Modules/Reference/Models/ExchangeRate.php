<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Company\CompanyContext;
use App\Core\Documents\HasVersion;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Support\HasUuid7;
use App\Modules\Reference\Database\factories\ExchangeRateFactory;
use App\Modules\Reference\Enums\RateSource;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string|null $company_id
 */
class ExchangeRate extends Model
{
    use BelongsToCompany;

    /** @use HasFactory<ExchangeRateFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'exchange_rates';

    /** @var list<string> */
    protected $fillable = ['currency_code', 'rate_date', 'forex_buying', 'forex_selling', 'banknote_buying', 'banknote_selling', 'source'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): ExchangeRateFactory
    {
        return ExchangeRateFactory::new();
    }

    /** Replaces the trait scope: global TCMB fixings plus the active company's own manual rates. */
    public static function bootBelongsToCompany(): void
    {
        static::creating(static function (Model $model): void {
            $source = $model->getAttribute('source');
            $manual = ($source instanceof RateSource ? $source->value : $source) === RateSource::Manual->value;
            $company = $model->getAttribute('company_id');
            if (! $manual) {
                if ($company !== null) {
                    throw new ApiException(ErrorCode::CompanyForbidden);
                }

                return;
            }
            $active = app(CompanyContext::class)->id();
            if ($company !== null && $company !== $active) {
                throw new ApiException(ErrorCode::CompanyForbidden);
            }
            $model->setAttribute('company_id', $active);
        });
        static::updating(static function (Model $model): void {
            if ($model->isDirty('company_id') || $model->isDirty('source')) {
                throw new ApiException(ErrorCode::CompanyForbidden);
            }
        });
        static::addGlobalScope('visible', function (Builder $query): void {
            $company = app(CompanyContext::class)->idOrNull();
            $query->where(function (Builder $visible) use ($company): void {
                $visible->whereNull('company_id');
                if ($company !== null) {
                    $visible->orWhere('company_id', $company);
                }
            });
        });
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'forex_buying' => 'decimal:6',
            'forex_selling' => 'decimal:6',
            'banknote_buying' => 'decimal:6',
            'banknote_selling' => 'decimal:6',
            'source' => RateSource::class,
        ];
    }
}
