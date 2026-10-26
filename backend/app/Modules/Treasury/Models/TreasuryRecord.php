<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 * @property int $version
 */
abstract class TreasuryRecord extends Model
{
    use BelongsToCompany,HasUuid7,HasVersion,LogsActivity;

    protected $guarded = ['id', 'company_id', 'version'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logAll()->logOnlyDirty()->dontLogEmptyChanges();
    }
}
