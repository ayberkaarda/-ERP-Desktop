<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Core\Money\DecimalCast;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * 1 from_unit = factor to_unit.
 *
 * @property string $from_unit_id
 * @property string $to_unit_id
 * @property BigDecimal $factor
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Unit|null $fromUnit
 * @property-read Unit|null $toUnit
 */
class UnitConversion extends CatalogModel
{
    use HasVersion;

    public const array FIELDS = ['from_unit_id', 'to_unit_id', 'factor'];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    public function getMorphClass(): string
    {
        return 'unit_conversion';
    }

    /** @return BelongsTo<Unit, $this> */
    public function fromUnit(): BelongsTo
    {
        return $this->belongsTo(Unit::class, 'from_unit_id');
    }

    /** @return BelongsTo<Unit, $this> */
    public function toUnit(): BelongsTo
    {
        return $this->belongsTo(Unit::class, 'to_unit_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['factor' => DecimalCast::class];
    }
}
