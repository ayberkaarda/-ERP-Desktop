<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Accounting\Database\factories\AccountFactory;
use App\Modules\Accounting\Enums\AccountType;
use App\Modules\Accounting\Enums\NormalBalance;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Chart of accounts node. Only leaves may be postable (enforced by a trigger).
 *
 * @property string $code
 * @property string $name
 * @property string|null $parent_id
 * @property int $level
 * @property AccountType $type
 * @property NormalBalance $normal_balance
 * @property bool $is_postable
 * @property bool $is_active
 * @property bool $is_system
 * @property int|null $tdhp_group
 * @property string|null $currency_code
 * @property bool $requires_party
 * @property bool $requires_cost_center
 * @property bool $requires_project
 * @property bool $is_revaluable
 * @property string|null $notes
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Account|null $parent
 */
class Account extends AccountingModel
{
    /** @use HasFactory<AccountFactory> */
    use HasFactory;

    use HasVersion;

    public const array FIELDS = [
        'code', 'name', 'parent_id', 'type', 'normal_balance', 'is_postable', 'is_active', 'tdhp_group',
        'currency_code', 'requires_party', 'requires_cost_center', 'requires_project', 'is_revaluable', 'notes',
    ];

    /** Writable through the API; parent_id, level and is_system are set by the service. */
    public const array EDITABLE = [
        'code', 'name', 'type', 'normal_balance', 'is_postable', 'is_active', 'tdhp_group', 'currency_code',
        'requires_party', 'requires_cost_center', 'requires_project', 'is_revaluable', 'notes',
    ];

    /** @var list<string> */
    protected $fillable = self::EDITABLE;

    /** @var array<string, mixed> */
    protected $attributes = [
        'is_postable' => true, 'is_active' => true, 'is_system' => false, 'level' => 1,
        'requires_party' => false, 'requires_cost_center' => false, 'requires_project' => false, 'is_revaluable' => false,
    ];

    public function getMorphClass(): string
    {
        return 'account';
    }

    /** @return BelongsTo<Account, $this> */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /** @return HasMany<Account, $this> */
    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    protected static function newFactory(): AccountFactory
    {
        return AccountFactory::new();
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'level' => 'integer',
            'type' => AccountType::class,
            'normal_balance' => NormalBalance::class,
            'is_postable' => 'boolean',
            'is_active' => 'boolean',
            'is_system' => 'boolean',
            'tdhp_group' => 'integer',
            'requires_party' => 'boolean',
            'requires_cost_center' => 'boolean',
            'requires_project' => 'boolean',
            'is_revaluable' => 'boolean',
        ];
    }
}
