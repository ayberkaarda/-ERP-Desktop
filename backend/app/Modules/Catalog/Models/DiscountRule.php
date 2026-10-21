<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Core\Money\DecimalCast;
use App\Modules\Catalog\Enums\DiscountScope;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * scope item/category: scope_ref is the item or category (whole subtree); scope party applies to
 * every item for party_id; party_id on other scopes narrows the rule to that party.
 *
 * @property string $code
 * @property string $name
 * @property DiscountScope $scope
 * @property string|null $scope_ref
 * @property string|null $party_id
 * @property BigDecimal $min_qty
 * @property BigDecimal $discount_percent
 * @property int $priority
 * @property bool $stackable
 * @property Carbon|null $valid_from
 * @property Carbon|null $valid_to
 * @property bool $is_active
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class DiscountRule extends CatalogModel
{
    use HasVersion;
    use SoftDeletes;

    public const array FIELDS = [
        'code', 'name', 'scope', 'scope_ref', 'party_id', 'min_qty', 'discount_percent', 'priority',
        'stackable', 'valid_from', 'valid_to', 'is_active',
    ];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true, 'stackable' => false, 'priority' => 0, 'min_qty' => '0.000000'];

    public function getMorphClass(): string
    {
        return 'discount_rule';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'scope' => DiscountScope::class,
            'min_qty' => DecimalCast::class,
            'discount_percent' => DecimalCast::class.':4',
            'priority' => 'integer',
            'stackable' => 'boolean',
            'is_active' => 'boolean',
            'valid_from' => 'date',
            'valid_to' => 'date',
        ];
    }
}
