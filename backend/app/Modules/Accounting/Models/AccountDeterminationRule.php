<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Models;

use App\Core\Documents\HasVersion;
use App\Modules\Accounting\Enums\Side;
use App\Modules\Accounting\Support\JsonObjectCast;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property string $event_key
 * @property int $priority
 * @property array<string, string|list<string>> $conditions
 * @property string $account_id
 * @property Side|null $side
 * @property string|null $description
 * @property bool $is_system
 * @property bool $is_active
 * @property int $version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Account $account
 */
class AccountDeterminationRule extends AccountingModel
{
    use HasVersion;

    public const array FIELDS = ['event_key', 'priority', 'conditions', 'account_id', 'side', 'description', 'is_active'];

    /** @var list<string> */
    protected $fillable = ['event_key', 'priority', 'conditions', 'account_id', 'side', 'description', 'is_active'];

    /** @var array<string, mixed> */
    protected $attributes = ['priority' => 0, 'conditions' => '{}', 'is_system' => false, 'is_active' => true];

    public function getMorphClass(): string
    {
        return 'account_determination_rule';
    }

    /** @return BelongsTo<Account, $this> */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'priority' => 'integer',
            'conditions' => JsonObjectCast::class,
            'side' => Side::class,
            'is_system' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
