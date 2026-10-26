<?php

declare(strict_types=1);

namespace Tests\Feature\Sync\Support;

use App\Core\Support\HasUuid7;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Row of a company_or_global resource (`fixture-rates`): company_id NULL is a system row every
 * company sees, like TCMB exchange rates.
 *
 * @property string $id
 * @property string|null $company_id
 * @property string $name
 */
final class SharedRate extends Model
{
    use HasUuid7;

    public const string TABLE = 'sync_test_shared_rates';

    protected $table = self::TABLE;

    protected $guarded = [];

    public static function install(): void
    {
        if (! Schema::hasTable(self::TABLE)) {
            Schema::create(self::TABLE, function (Blueprint $table): void {
                $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
                $table->uuid('company_id')->nullable()->index();
                $table->string('name', 50);
                $table->timestampsTz();
                $table->syncable();
            });
        }
    }
}
