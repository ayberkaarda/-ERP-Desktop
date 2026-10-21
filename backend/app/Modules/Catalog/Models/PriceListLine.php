<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property string $price_list_id
 * @property string $item_id
 * @property string|null $variant_id
 * @property string $unit_id
 * @property BigDecimal $min_qty
 * @property BigDecimal $price
 * @property Carbon|null $valid_from
 * @property Carbon|null $valid_to
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read PriceList|null $priceList
 */
class PriceListLine extends CatalogModel
{
    use HasVersion;

    public const array FIELDS = ['price_list_id', 'item_id', 'variant_id', 'unit_id', 'min_qty', 'price', 'valid_from', 'valid_to'];

    /** @var list<string> */
    protected $fillable = ['item_id', 'variant_id', 'unit_id', 'min_qty', 'price', 'valid_from', 'valid_to'];

    public function getMorphClass(): string
    {
        return 'price_list_line';
    }

    /** @return BelongsTo<PriceList, $this> */
    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'min_qty' => DecimalCast::class,
            'price' => DecimalCast::class,
            'valid_from' => 'date',
            'valid_to' => 'date',
        ];
    }
}
