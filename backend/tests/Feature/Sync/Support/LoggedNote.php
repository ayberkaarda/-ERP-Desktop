<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use Illuminate\Database\Eloquent\Model;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;
use Tests\Fixtures\Sync\FixtureNote;

/**
 * The fixture note table seen through a model that logs like the module models do
 * (logOnly + version, logOnlyDirty), so server edits write real activity_log entries
 * (attribute_changes) for the subject the sync writer loads (FixtureNote).
 *
 * @property string $title
 * @property string $status
 */
final class LoggedNote extends Model
{
    use BelongsToCompany;
    use HasVersion;
    use LogsActivity;

    protected $table = 'sync_fixture_notes';

    protected $guarded = [];

    protected $keyType = 'string';

    public $incrementing = false;

    public function getMorphClass(): string
    {
        return (new FixtureNote)->getMorphClass();
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['title', 'status', 'version'])->logOnlyDirty()->dontLogEmptyChanges();
    }
}
