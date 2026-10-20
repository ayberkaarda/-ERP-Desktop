<?php

declare(strict_types=1);

namespace Tests\Fixtures;

use App\Core\Company\BelongsToCompany;
use App\Core\Documents\HasStatus;
use App\Core\Documents\HasVersion;
use App\Core\Documents\InteractsWithStatus;
use App\Core\Money\DecimalCast;
use App\Core\Money\MoneyCast;
use App\Core\Support\HasUuid7;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Exercises every Core model primitive at once.
 *
 * @property string $id
 * @property string $company_id
 * @property string $name
 * @property FixtureStatus $status
 * @property BigDecimal|null $total
 * @property BigDecimal|null $quantity
 * @property BigDecimal|null $rate
 * @property int $version
 */
final class FixtureDocument extends Model implements HasStatus
{
    use BelongsToCompany;
    use HasUuid7;
    use HasVersion;
    use InteractsWithStatus;

    protected $table = 'fixture_documents';

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => FixtureStatus::class,
            'total' => MoneyCast::class,
            'quantity' => DecimalCast::class,
            'rate' => DecimalCast::class.':2',
        ];
    }

    public static function createTable(?string $connection = null): void
    {
        Schema::connection($connection)->create('fixture_documents', function (Blueprint $table): void {
            $table->uuid('id')->primary()->default(DB::raw('uuidv7()'));
            $table->uuid('company_id')->index();
            $table->string('number')->nullable();
            $table->string('name')->default('');
            $table->string('status', 16)->default('draft');
            $table->decimal('total', 20, 4)->nullable();
            $table->decimal('quantity', 20, 6)->nullable();
            $table->decimal('rate', 20, 6)->nullable();
            $table->unsignedInteger('version');
            $table->timestampsTz();
        });
    }
}
