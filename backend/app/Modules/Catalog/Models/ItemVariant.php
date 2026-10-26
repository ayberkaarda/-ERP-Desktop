<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * The json column `attributes` shadows Eloquent internals: read it with getAttribute().
 *
 * @property string $item_id
 * @property string $sku
 * @property string|null $name
 * @property bool $is_active
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Item|null $item
 */
class ItemVariant extends CatalogModel
{
    use HasVersion;
    use SoftDeletes;

    public const array FIELDS = ['item_id', 'sku', 'name', 'attributes', 'is_active'];

    /** @var list<string> */
    protected $fillable = ['sku', 'name', 'attributes', 'is_active'];

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true];

    public function getMorphClass(): string
    {
        return 'item_variant';
    }

    /** @return BelongsTo<Item, $this> */
    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'attributes' => 'array'];
    }
}
