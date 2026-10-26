<?php

declare(strict_types=1);

namespace Tests\Fixtures\Sync;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasVersion;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * Company-scoped, versioned, soft-deleting document with lines: the shape most sync
 * resources have (parties, quotes, stock documents).
 *
 * @property string $id
 * @property string $company_id
 * @property string $title
 * @property string $status
 * @property int $version
 * @property string $sync_txid
 * @property Carbon|null $updated_at
 */
final class FixtureNote extends Model
{
    use BelongsToCompany;
    use HasUuid7;
    use HasVersion;
    use SoftDeletes;

    protected $table = 'sync_fixture_notes';

    protected $guarded = [];

    /**
     * @return HasMany<FixtureNoteLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(FixtureNoteLine::class, 'note_id')->orderBy('position');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }
}
