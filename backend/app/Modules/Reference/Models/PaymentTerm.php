<?php

declare(strict_types=1);

namespace App\Modules\Reference\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use App\Modules\Reference\Database\factories\PaymentTermFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 */
class PaymentTerm extends Model
{
    use BelongsToCompany;

    /** @use HasFactory<PaymentTermFactory> */
    use HasFactory;

    use HasUuid7;
    use HasVersion;
    use LogsActivity;
    use SoftDeletes;

    protected $table = 'payment_terms';

    /** @var list<string> */
    protected $fillable = ['code', 'name', 'due_days', 'discount_percent', 'discount_days', 'is_active'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }

    protected static function newFactory(): PaymentTermFactory
    {
        return PaymentTermFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'due_days' => 'integer',
            'discount_percent' => 'decimal:4',
            'discount_days' => 'integer',
            'is_active' => 'boolean',
        ];
    }
}
