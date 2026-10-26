<?php

declare(strict_types=1);

namespace App\Modules\Catalog\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Catalog\Database\factories\UnitFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * @property string $code
 * @property string $name
 * @property string|null $symbol
 * @property bool $is_active
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class Unit extends CatalogModel
{
    /** @use HasFactory<UnitFactory> */
    use HasFactory;

    use HasVersion;
    use SoftDeletes;

    public const array FIELDS = ['code', 'name', 'symbol', 'is_active'];

    /** @var list<string> */
    protected $fillable = self::FIELDS;

    /** @var array<string, mixed> */
    protected $attributes = ['is_active' => true];

    public function getMorphClass(): string
    {
        return 'unit';
    }

    protected static function newFactory(): UnitFactory
    {
        return UnitFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }
}
