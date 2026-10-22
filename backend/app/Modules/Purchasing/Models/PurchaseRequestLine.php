<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Money\DecimalCast;
use App\Core\Support\HasUuid7;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
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
 * @property BigDecimal $estimated_price
 * @property BigDecimal $estimated_total
 * @property string|null $suggested_supplier_id
 * @property Carbon|null $needed_by
 * @property string|null $warehouse_id
 */
class PurchaseRequestLine extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    public $timestamps = false;

    protected $table = 'purchase_request_lines';

    /** @var list<string> */
    protected $guarded = ['id', 'company_id'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'line_no' => 'integer', 'quantity' => DecimalCast::class, 'base_quantity' => DecimalCast::class,
            'estimated_price' => DecimalCast::class, 'estimated_total' => DecimalCast::class.':4', 'needed_by' => 'date',
        ];
    }
}
