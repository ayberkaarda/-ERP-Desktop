<?php

declare(strict_types=1);

namespace App\Modules\Parties\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Money\MoneyCast;
use App\Core\Support\HasUuid7;
use App\Modules\Files\Contracts\Attachable;
use App\Modules\Parties\Database\factories\PartyFactory;
use App\Modules\Parties\Enums\PartyType;
use App\Modules\Parties\Validation\TaxNumber;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 * @property string $code
 * @property string $name
 * @property string|null $legal_name
 * @property PartyType $type
 * @property list<string> $roles
 * @property string|null $tax_office
 * @property string|null $tax_number
 * @property string|null $tax_number_canonical
 * @property string $country
 * @property string|null $default_currency_code
 * @property string|null $payment_term_id
 * @property string|null $price_list_id
 * @property BigDecimal|null $risk_limit
 * @property string|null $risk_currency_code
 * @property bool $is_active
 * @property string|null $notes
 * @property list<string> $tags
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
class Party extends Model implements Attachable
{
    use BelongsToCompany;

    /** @use HasFactory<PartyFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    /** Client-writable attributes; code and version are owned by the service. */
    public const array FIELDS = [
        'name', 'legal_name', 'type', 'roles', 'tax_office', 'tax_number', 'country', 'default_currency_code',
        'payment_term_id', 'price_list_id', 'risk_limit', 'risk_currency_code', 'is_active', 'notes', 'tags',
    ];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true, 'country' => 'TR', 'tags' => '[]'];

    protected static function booted(): void
    {
        static::saving(static function (Party $party): void {
            $party->tax_number_canonical = TaxNumber::canonical($party->tax_number);
        });
    }

    public function getMorphClass(): string
    {
        return 'party';
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['code', ...self::FIELDS])->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** @return HasMany<PartyAddress, $this> */
    public function addresses(): HasMany
    {
        return $this->hasMany(PartyAddress::class);
    }

    /** @return HasMany<PartyContact, $this> */
    public function contacts(): HasMany
    {
        return $this->hasMany(PartyContact::class);
    }

    /** @return HasMany<PartyBankAccount, $this> */
    public function bankAccounts(): HasMany
    {
        return $this->hasMany(PartyBankAccount::class);
    }

    protected static function newFactory(): PartyFactory
    {
        return PartyFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'type' => PartyType::class,
            'roles' => 'array',
            'tags' => 'array',
            'risk_limit' => MoneyCast::class,
            'is_active' => 'boolean',
        ];
    }
}
