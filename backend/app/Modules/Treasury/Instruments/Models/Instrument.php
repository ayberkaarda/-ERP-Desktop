<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Instruments\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * @property string $id
 * @property string $company_id
 * @property string $kind
 * @property string $direction
 * @property string $status
 * @property string $party_id
 * @property string $amount
 * @property string $currency_code
 * @property string $fx_rate
 * @property string $local_amount
 * @property string $issue_date
 * @property string $due_date
 * @property string|null $number
 * @property string|null $journal_entry_id
 * @property int $version
 */
final class Instrument extends Model
{
    use BelongsToCompany, HasUuid7, HasVersion, LogsActivity;

    protected $table = 'treasury_instruments';

    protected $guarded = ['id', 'company_id', 'version'];

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['status', 'instrument_number', 'party_id', 'amount', 'version'])->logOnlyDirty()->dontLogEmptyChanges();
    }
}
