<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Catalog\Database\factories\ItemCategoryFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * Tree node; path is "/<root id>/.../<own id>/" and depth starts at 1 for roots.
 *
 * @property string|null $parent_id
 * @property string $code
 * @property string $name
 * @property string $path
 * @property int $depth
 * @property bool $is_active
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read ItemCategory|null $parent
 */
class ItemCategory extends CatalogModel
{
    /** @use HasFactory<ItemCategoryFactory> */
    use HasFactory;

    use HasVersion;
    use SoftDeletes;

    public const array FIELDS = ['parent_id', 'code', 'name', 'is_active'];

    /** @var list<string> */
    protected $fillable = ['code', 'name', 'is_active'];

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true];

    public function getMorphClass(): string
    {
        return 'item_category';
    }

    /** @return BelongsTo<ItemCategory, $this> */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    protected static function newFactory(): ItemCategoryFactory
    {
        return ItemCategoryFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'depth' => 'integer'];
    }
}
