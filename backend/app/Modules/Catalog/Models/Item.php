<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Core\Money\DecimalCast;
use App\Modules\Catalog\Database\factories\ItemFactory;
use App\Modules\Catalog\Enums\ItemTracking;
use App\Modules\Catalog\Enums\ItemType;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * @property string $code
 * @property string $name
 * @property string|null $description
 * @property ItemType $type
 * @property string $base_unit_id
 * @property string|null $category_id
 * @property string|null $default_tax_code_id
 * @property string|null $purchase_tax_code_id
 * @property ItemTracking $tracking
 * @property bool $has_expiry
 * @property BigDecimal|null $min_stock
 * @property BigDecimal|null $reorder_point
 * @property bool $is_active
 *                           The json column `attributes` shadows Eloquent internals: read it with getAttribute().
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Unit|null $baseUnit
 * @property-read ItemCategory|null $category
 * @property-read Collection<int, ItemUnit> $units
 * @property-read Collection<int, ItemVariant> $variants
 * @property-read Collection<int, ItemBarcode> $barcodes
 */
class Item extends CatalogModel
{
    /** @use HasFactory<ItemFactory> */
    use HasFactory;

    use HasVersion;
    use SoftDeletes;

    public const array FIELDS = [
        'code', 'name', 'description', 'type', 'base_unit_id', 'category_id', 'default_tax_code_id',
        'purchase_tax_code_id', 'tracking', 'has_expiry', 'min_stock', 'reorder_point', 'is_active', 'attributes',
    ];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true, 'has_expiry' => false, 'tracking' => 'none'];

    public function getMorphClass(): string
    {
        return 'item';
    }

    /** @return BelongsTo<Unit, $this> */
    public function baseUnit(): BelongsTo
    {
        return $this->belongsTo(Unit::class, 'base_unit_id');
    }

    /** @return BelongsTo<ItemCategory, $this> */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ItemCategory::class, 'category_id');
    }

    /** @return HasMany<ItemUnit, $this> */
    public function units(): HasMany
    {
        return $this->hasMany(ItemUnit::class);
    }

    /** @return HasMany<ItemVariant, $this> */
    public function variants(): HasMany
    {
        return $this->hasMany(ItemVariant::class);
    }

    /** @return HasMany<ItemBarcode, $this> */
    public function barcodes(): HasMany
    {
        return $this->hasMany(ItemBarcode::class);
    }

    protected static function newFactory(): ItemFactory
    {
        return ItemFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'type' => ItemType::class,
            'tracking' => ItemTracking::class,
            'has_expiry' => 'boolean',
            'is_active' => 'boolean',
            'min_stock' => DecimalCast::class,
            'reorder_point' => DecimalCast::class,
            'attributes' => 'array',
        ];
    }
}
