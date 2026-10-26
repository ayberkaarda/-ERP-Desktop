<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Company\BelongsToCompany;
use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dated, company-scoped row for the windowed resource `fixture-dated-notes`
 * (window_field note_date), the shape of the 30-day document resources.
 *
 * @property string $id
 * @property string $company_id
 * @property string $title
 * @property string $note_date
 */
final class DatedNote extends Model
{
    use BelongsToCompany;
    use HasUuid7;

    public const string TABLE = 'sync_test_dated_notes';

    protected $table = self::TABLE;

    protected $guarded = [];

    public static function install(): void
    {
        if (Schema::hasTable(self::TABLE)) {
            return;
        }

        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->string('title', 100);
            $table->date('note_date');
            $table->timestampsTz();
            $table->syncable();
        });
    }
}
