<?php

declare(strict_types=1);

namespace App\Modules\Sales\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Money\DecimalCast;
use App\Core\Support\HasUuid7;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;

/**
 * Common line of the sales documents. Written with its document and audited through it.
 * Quantities are in the line unit; base_quantity is converted to the item's base unit.
 *
 * @property string $id
 * @property string $company_id
 * @property string $document_id
 * @property int $line_no
 * @property string $item_id
 * @property string|null $variant_id
 * @property string $item_type
 * @property string|null $description
 * @property BigDecimal $quantity
 * @property string $unit_id
 * @property BigDecimal $base_quantity
 * @property BigDecimal $unit_price
 * @property bool $tax_inclusive
 * @property BigDecimal $discount_percent
 * @property BigDecimal $discount_amount
 * @property BigDecimal $gross_amount
 * @property BigDecimal $line_discount
 * @property BigDecimal $net_amount
 * @property string|null $tax_code_id
 * @property BigDecimal $tax_rate
 * @property BigDecimal $tax_amount
 * @property BigDecimal $line_total
 * @property string|null $warehouse_id
 * @property string|null $source_line_id
 * @property string|null $price_source
 */
abstract class SalesLine extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    /** Columns every line type stores. */
    public const array COLUMNS = [
        'line_no', 'item_id', 'variant_id', 'item_type', 'description', 'quantity', 'unit_id', 'base_quantity', 'unit_price',
        'tax_inclusive', 'discount_percent', 'discount_amount', 'gross_amount', 'line_discount', 'net_amount', 'tax_code_id',
        'tax_rate', 'tax_amount', 'line_total', 'warehouse_id', 'source_line_id', 'price_source',
    ];

    public $timestamps = false;

    /** @var list<string> */
    protected $guarded = ['id', 'company_id'];

    public function isStock(): bool
    {
        return $this->item_type === 'stock';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'line_no' => 'integer',
            'quantity' => DecimalCast::class,
            'base_quantity' => DecimalCast::class,
            'unit_price' => DecimalCast::class,
            'tax_inclusive' => 'boolean',
            'discount_percent' => DecimalCast::class.':4',
            'discount_amount' => DecimalCast::class.':4',
            'gross_amount' => DecimalCast::class.':4',
            'line_discount' => DecimalCast::class.':4',
            'net_amount' => DecimalCast::class.':4',
            'tax_rate' => DecimalCast::class.':4',
            'tax_amount' => DecimalCast::class.':4',
            'line_total' => DecimalCast::class.':4',
            ...$this->extraCasts(),
        ];
    }

    /** @return array<string, string> */
    protected function extraCasts(): array
    {
        return [];
    }
}
