<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Alternate unit of an item: 1 unit = factor base units.
 *
 * @property string $item_id
 * @property string $unit_id
 * @property BigDecimal $factor
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Unit|null $unit
 */
class ItemUnit extends CatalogModel
{
    use HasVersion;

    public const array FIELDS = ['item_id', 'unit_id', 'factor'];

    /** @var list<string> */
    protected $fillable = ['unit_id', 'factor'];

    public function getMorphClass(): string
    {
        return 'item_unit';
    }

    /** @return BelongsTo<Unit, $this> */
    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['factor' => DecimalCast::class];
    }
}
