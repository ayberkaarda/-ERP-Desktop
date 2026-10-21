<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * Company scoped, UUIDv7 keyed and audited; subclasses list their audited FIELDS.
 *
 * @property string $id
 * @property string $company_id
 */
abstract class AccountingModel extends Model
{
    use BelongsToCompany;
    use HasUuid7;
    use LogsActivity;

    /** @var list<string> */
    public const array FIELDS = [];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(static::FIELDS)->logOnlyDirty()->dontLogEmptyChanges();
    }
}
