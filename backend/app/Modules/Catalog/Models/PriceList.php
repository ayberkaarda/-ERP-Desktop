<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * @property string $code
 * @property string $name
 * @property string $currency_code
 * @property bool $is_default
 * @property Carbon|null $valid_from
 * @property Carbon|null $valid_to
 * @property bool $is_active
 * @property bool $tax_inclusive
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class PriceList extends CatalogModel
{
    use HasVersion;
    use SoftDeletes;

    public const array FIELDS = ['code', 'name', 'currency_code', 'is_default', 'valid_from', 'valid_to', 'is_active', 'tax_inclusive'];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true, 'is_default' => false, 'tax_inclusive' => false];

    public function getMorphClass(): string
    {
        return 'price_list';
    }

    /** @return HasMany<PriceListLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PriceListLine::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'is_active' => 'boolean',
            'tax_inclusive' => 'boolean',
            'valid_from' => 'date',
            'valid_to' => 'date',
        ];
    }
}
