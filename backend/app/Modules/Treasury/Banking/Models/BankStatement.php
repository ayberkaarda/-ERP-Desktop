<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 * @property string $account_id
 * @property string $status
 * @property int $version
 */
final class BankStatement extends Model
{
    use BelongsToCompany, HasUuid7, HasVersion, LogsActivity;

    protected $table = 'treasury_bank_statements';

    protected $guarded = ['id', 'company_id', 'version'];

    protected $hidden = ['content_digest'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['status', 'version'])->logOnlyDirty()->dontLogEmptyChanges();
    }
}
