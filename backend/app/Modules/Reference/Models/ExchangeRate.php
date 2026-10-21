<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use App\Modules\Reference\Database\factories\ExchangeRateFactory;
use App\Modules\Reference\Enums\RateSource;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 */
class ExchangeRate extends Model
{
    /** @use HasFactory<ExchangeRateFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'exchange_rates';

    /** @var list<string> */
    protected $fillable = ['currency_code', 'rate_date', 'forex_buying', 'forex_selling', 'banknote_buying', 'banknote_selling', 'source'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): ExchangeRateFactory
    {
        return ExchangeRateFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'forex_buying' => 'decimal:6',
            'forex_selling' => 'decimal:6',
            'banknote_buying' => 'decimal:6',
            'banknote_selling' => 'decimal:6',
            'source' => RateSource::class,
        ];
    }
}
