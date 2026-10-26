<?php

declare(strict_types=1);

namespace App\Modules\Organization\Models;

use App\Core\Support\HasUuid7;
use App\Modules\Organization\Database\factories\CompanyFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * Tenant root; not company scoped itself.
 *
 * @property string $id
 * @property string $code
 * @property string $name
 * @property string|null $legal_name
 * @property string|null $tax_number
 * @property string|null $tax_office
 * @property string|null $email
 * @property string|null $phone
 * @property string|null $address
 * @property string $country_code
 * @property string $base_currency
 * @property string $timezone
 * @property string $locale
 * @property bool $is_active
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class Company extends Model
{
    /** @use HasFactory<CompanyFactory> */
    use HasFactory;

    use HasUuid7;
    use LogsActivity;
    use SoftDeletes;

    public const array FIELDS = [
        'code', 'name', 'legal_name', 'tax_number', 'tax_office', 'email', 'phone', 'address',
        'country_code', 'base_currency', 'timezone', 'locale', 'is_active',
    ];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = [
        'country_code' => 'TR',
        'base_currency' => 'TRY',
        'timezone' => 'Europe/Istanbul',
        'locale' => 'tr',
        'is_active' => true,
    ];

    public function getMorphClass(): string
    {
        return 'company';
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(self::FIELDS)->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): CompanyFactory
    {
        return CompanyFactory::new();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }
}
