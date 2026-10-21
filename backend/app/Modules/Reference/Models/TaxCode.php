<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Company\CompanyContext;
use App\Core\Documents\HasVersion;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use App\Core\Support\HasUuid7;
use App\Modules\Reference\Database\factories\TaxCodeFactory;
use App\Modules\Reference\Enums\TaxType;
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
class TaxCode extends Model
{
    use BelongsToCompany;

    /** @use HasFactory<TaxCodeFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'tax_codes';

    /** @var list<string> */
    protected $fillable = ['type', 'code', 'name', 'rate', 'numerator', 'denominator', 'effective_from', 'effective_to', 'is_active', 'meta'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): TaxCodeFactory
    {
        return TaxCodeFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'rate' => 'decimal:4',
            'numerator' => 'integer',
            'denominator' => 'integer',
            'is_active' => 'boolean',
            'meta' => 'array',
            'type' => TaxType::class,
        ];
    }

    public static function bootBelongsToCompany(): void
    {
        static::creating(static function (Model $model): void {
            $company = $model->getAttribute('company_id');
            if ($company !== null && $company !== app(CompanyContext::class)->idOrNull()) {
                throw new ApiException(ErrorCode::CompanyForbidden);
            }
        });
        static::updating(static function (Model $model): void {
            if ($model->isDirty('company_id')) {
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
}
