<?php

declare(strict_types=1);

namespace App\Modules\Parties\Models;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Spatie\Activitylog\Models\Concerns\LogsActivity;
use Spatie\Activitylog\Support\LogOptions;

/**
 * A record owned by one party that may be the default within a group (e.g. per address type).
 *
 * @property string $id
 * @property string $company_id
 * @property string $party_id
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
abstract class PartyChild extends Model
{
    use BelongsToCompany;
    use HasUuid7;
    use HasVersion;
    use LogsActivity;

    /** @return list<string> */
    abstract public static function fields(): array;

    /** Boolean column that only one row per group may set. */
    abstract public static function defaultFlag(): string;

    /**
     * Columns besides party_id that form the default group.
     *
     * @return list<string>
     */
    public static function defaultGroup(): array
    {
        return [];
    }

    public function getActivitylogOptions(): LogOptions
    {
        return LogOptions::defaults()->logOnly(['party_id', ...static::fields()])->logOnlyDirty()->dontLogEmptyChanges();
    }

    /** @return BelongsTo<Party, $this> */
    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function isDefault(): bool
    {
        return $this->getAttribute(static::defaultFlag()) === true;
    }
}
