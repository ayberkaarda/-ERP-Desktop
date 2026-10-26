<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Catalog\Enums\BarcodeType;
use Illuminate\Support\Carbon;

/**
 * @property string $item_id
 * @property string|null $variant_id
 * @property string $unit_id
 * @property string $barcode
 * @property BarcodeType $type
 * @property bool $is_primary
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class ItemBarcode extends CatalogModel
{
    use HasVersion;

    public const array FIELDS = ['item_id', 'variant_id', 'unit_id', 'barcode', 'type', 'is_primary'];

    /** @var list<string> */
    protected $fillable = ['variant_id', 'unit_id', 'barcode', 'type', 'is_primary'];

    /** @var array<string, mixed> */
    protected $attributes = ['is_primary' => false, 'type' => 'other'];

    public function getMorphClass(): string
    {
        return 'item_barcode';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['type' => BarcodeType::class, 'is_primary' => 'boolean'];
    }
}
