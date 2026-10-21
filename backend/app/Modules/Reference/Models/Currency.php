<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use App\Modules\Reference\Database\factories\CurrencyFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 */
class Currency extends Model
{
    /** @use HasFactory<CurrencyFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'currencies';

    /** @var list<string> */
    protected $fillable = ['code', 'name', 'symbol', 'decimals', 'is_active'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): CurrencyFactory
    {
        return CurrencyFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'decimals' => 'integer',
            'is_active' => 'boolean',
        ];
    }
}
